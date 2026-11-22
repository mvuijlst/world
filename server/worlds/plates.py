"""GPlates files for the Plates step, made and read with pyGPlates.

  GET  /api/plates/status   → {"available": bool, "version": str}
  POST /api/plates/export   {"name", "plates": [{id, name}], "features": [{kind, plateId, name, coords}]}
                            → a .zip with <name>.gpml (the features) and <name>.rot (rotations)
  POST /api/plates/import   multipart "file": a .gpml or .gpmlz feature collection
                            → {"features": [...], "plates": [...], "skipped": n}

Shapes are [lat, lon] lists. kind is craton | crust | rift | failed, written as the GPlates feature
types Craton, ContinentalCrust and ContinentalRift (a failed rift is a ContinentalRift whose
description says so). The rotation file holds one fixed rotation per plate, relative to plate 0,
from the present back to 4000 Ma: plates that have not moved yet, ready for rotation poles to be
added in GPlates. These views keep no state and need no account.
"""
import io
import json
import os
import re
import tempfile
import zipfile

from django.http import HttpResponse, JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_GET, require_POST

MAX_BODY = 4 * 1024 * 1024
MAX_FEATURES = 2000
MAX_POINTS = 20000
KINDS = {'craton': 'Craton', 'crust': 'ContinentalCrust', 'rift': 'ContinentalRift', 'failed': 'ContinentalRift'}
FAILED = 'failed rift'
OLDEST = 4000.0


def pygplates():
    """The module, or None where it is not installed (it is imported on first use: it is large)."""
    try:
        import pygplates as pg  # noqa: PLC0415
        return pg
    except Exception:  # ImportError, or a missing system library such as libGL
        return None


def error(message, status=400):
    return JsonResponse({'error': message}, status=status)


@require_GET
def status(request):
    pg = pygplates()
    return JsonResponse({'available': pg is not None, 'version': getattr(pg, '__version__', None) if pg else None})


def _clean_coords(coords, closed):
    if not isinstance(coords, list):
        return None
    pts = []
    for p in coords:
        if not (isinstance(p, (list, tuple)) and len(p) == 2):
            return None
        lat, lon = p
        if not all(isinstance(v, (int, float)) for v in (lat, lon)) or not (-90 <= lat <= 90) or not (-360 <= lon <= 360):
            return None
        pts.append((float(lat), float(lon)))
    return pts if len(pts) >= (3 if closed else 2) else None


def _safe(name):
    return re.sub(r'[^\w-]+', '_', str(name or 'world'))[:60] or 'world'


@csrf_exempt  # stateless: no session, no account, nothing stored
@require_POST
def export(request):
    pg = pygplates()
    if pg is None:
        return error('pyGPlates is not installed on this server.', 503)
    if len(request.body) > MAX_BODY:
        return error('Too large.', 413)
    try:
        data = json.loads(request.body or b'{}')
    except ValueError:
        return error('Bad request')
    feats = data.get('features')
    if not isinstance(feats, list) or not feats or len(feats) > MAX_FEATURES:
        return error('Nothing to export.')
    plate_names = {}
    for p in data.get('plates') or []:
        if isinstance(p, dict) and isinstance(p.get('id'), int):
            plate_names[p['id']] = str(p.get('name') or '')[:80]

    out, points, plate_ids = [], 0, set()
    for f in feats:
        if not isinstance(f, dict) or f.get('kind') not in KINDS:
            continue
        closed = f['kind'] in ('craton', 'crust')
        coords = _clean_coords(f.get('coords'), closed)
        if coords is None:
            continue
        points += len(coords)
        if points > MAX_POINTS:
            return error('Too many points.', 413)
        plate_id = f.get('plateId') if isinstance(f.get('plateId'), int) and 0 <= f.get('plateId') < 100000 else 0
        plate_ids.add(plate_id)
        geometry = pg.PolygonOnSphere(coords) if closed else pg.PolylineOnSphere(coords)
        feature = pg.Feature.create_reconstructable_feature(
            pg.FeatureType.create_gpml(KINDS[f['kind']]), geometry,
            name=str(f.get('name') or '')[:120], valid_time=(OLDEST, pg.GeoTimeInstant.create_distant_future()),
            reconstruction_plate_id=plate_id)
        if f['kind'] == 'failed':
            feature.set_description(FAILED)
        out.append(feature)
    if not out:
        return error('No valid shapes to export.')

    # one fixed (identity) rotation per plate relative to 000, at 0 and 4000 Ma
    ident = pg.FiniteRotation.create_identity_rotation()
    rotations = []
    for pid in sorted(plate_ids - {0}):
        seq = pg.Feature.create_total_reconstruction_sequence(0, pid, pg.GpmlIrregularSampling([
            pg.GpmlTimeSample(pg.GpmlFiniteRotation(ident), 0.0, plate_names.get(pid) or f'Plate {pid}'),
            pg.GpmlTimeSample(pg.GpmlFiniteRotation(ident), OLDEST, plate_names.get(pid) or f'Plate {pid}'),
        ]))
        rotations.append(seq)

    name = _safe(data.get('name'))
    buf = io.BytesIO()
    with tempfile.TemporaryDirectory() as tmp:
        gpml, rot = os.path.join(tmp, f'{name}.gpml'), os.path.join(tmp, f'{name}.rot')
        pg.FeatureCollection(out).write(gpml)
        pg.FeatureCollection(rotations).write(rot)
        with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as z:
            z.write(gpml, f'{name}.gpml')
            z.write(rot, f'{name}.rot')
            z.writestr('README.txt', (
                f'{name} - supercontinent exported from WorldSmith\n\n'
                f'{name}.gpml  cratons, continental crust and rifts (failed rifts: ContinentalRift, description "{FAILED}")\n'
                f'{name}.rot   one fixed rotation per plate (relative to plate 0, 0-{OLDEST:.0f} Ma): add your poles here\n\n'
                'In GPlates: File > Open Feature Collection, and open both files.\n'))
    resp = HttpResponse(buf.getvalue(), content_type='application/zip')
    resp['Content-Disposition'] = f'attachment; filename="{name}-gplates.zip"'
    return resp


@csrf_exempt  # stateless: no session, no account, nothing stored
@require_POST
def import_(request):
    pg = pygplates()
    if pg is None:
        return error('pyGPlates is not installed on this server.', 503)
    up = request.FILES.get('file')
    if up is None:
        return error('Send a .gpml or .gpmlz file as "file".')
    if up.size > MAX_BODY:
        return error('Too large.', 413)
    ext = os.path.splitext(up.name)[1].lower()
    if ext not in ('.gpml', '.gpmlz'):
        return error('Only .gpml and .gpmlz files can be read here.')
    with tempfile.TemporaryDirectory() as tmp:
        path = os.path.join(tmp, f'upload{ext}')
        with open(path, 'wb') as fh:
            for chunk in up.chunks():
                fh.write(chunk)
        try:
            collection = pg.FeatureCollection(path)
        except Exception:
            return error('That file could not be read as a GPlates feature collection.')
        if len(collection) == 0:
            return error('That file holds no GPlates features.')

    features, plates, skipped, points = [], {}, 0, 0
    for feature in collection:
        ftype = feature.get_feature_type().get_name()
        kind = {'Craton': 'craton', 'ContinentalCrust': 'crust', 'ContinentalRift': 'rift'}.get(ftype)
        if kind is None:
            skipped += 1
            continue
        if kind == 'rift' and FAILED in (feature.get_description() or '').lower():
            kind = 'failed'
        plate_id = feature.get_reconstruction_plate_id(0)
        for geometry in feature.get_geometries():
            closed = isinstance(geometry, pg.PolygonOnSphere)
            if kind in ('craton', 'crust') and not closed:
                continue
            if kind in ('rift', 'failed') and not isinstance(geometry, pg.PolylineOnSphere):
                continue
            coords = [[round(lat, 4), round(lon, 4)] for lat, lon in geometry.to_lat_lon_list()]
            if closed and len(coords) > 3 and coords[0] == coords[-1]:
                coords = coords[:-1]
            points += len(coords)
            if points > MAX_POINTS or len(features) >= MAX_FEATURES:
                return error('Too many shapes or points.', 413)
            features.append({'kind': kind, 'plateId': int(plate_id), 'name': feature.get_name() or '', 'coords': coords})
            plates.setdefault(int(plate_id), {'id': int(plate_id), 'name': f'Plate {plate_id}'})
    return JsonResponse({'features': features, 'plates': list(plates.values()), 'skipped': skipped})
