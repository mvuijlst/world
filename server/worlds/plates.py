"""GPlates files for the Plates step, made and read with pyGPlates.

  GET  /api/plates/status   → {"available": bool, "version": str}
  POST /api/plates/export   {"name", "start", "step",
                             "plates": [{id, name, fixed, rotations: [{age, lat, lon, angle}]}],
                             "features": [{kind, plateId, name, coords, left, right}]}
                            → a .zip with <name>.gpml (the features and flowlines) and <name>.rot
  POST /api/plates/import   multipart "file": a .gpml or .gpmlz feature collection
                            → {"features": [...], "plates": [...], "skipped": n}

Shapes are [lat, lon] lists. kind is craton | crust | rift | failed | subduction | arc, written as the
GPlates feature types Craton, ContinentalCrust, ContinentalRift (a failed rift is a ContinentalRift
whose description says so), SubductionZone (on the overriding plate, with its subductionPolarity: the
overriding side, left or right of the line as drawn) and IslandArc. A rift, trench or arc may begin
after the start age ("begin") and a trench end before the present ("end"): their valid times. Shapes are stored as they were at the start age (the supercontinent as drawn),
where every rotation is the identity. The rotation file holds each plate's total rotations relative
to its fixed plate: the identity at the start age (and back to 4000 Ma), the poles set in WorldSmith,
and the youngest pole again at 0 Ma, so the plate holds still after its last move. A rift with a
plate on each side also gets a Flowline (seeded on the rift at the start age, reverse-reconstructed
with pyGPlates), so GPlates draws the spreading. These views keep no state and need no account.
"""
import io
import json
import math
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
KINDS = {'craton': 'Craton', 'crust': 'ContinentalCrust', 'rift': 'ContinentalRift', 'failed': 'ContinentalRift',
         'subduction': 'SubductionZone', 'arc': 'IslandArc'}
CLOSED = ('craton', 'crust', 'arc')
POLARITY = 'subductionPolarity'
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


def _number(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def _plate_id(v):
    return v if isinstance(v, int) and not isinstance(v, bool) and 0 < v < 100000 else None


def _samples(rotations, start):
    """Valid poles younger than the start age, one per age: [(age, lat, lon, angle)], youngest first."""
    out = {}
    for r in rotations if isinstance(rotations, list) else []:
        if not isinstance(r, dict):
            continue
        vals = [r.get(k) for k in ('age', 'lat', 'lon', 'angle')]
        if not all(_number(v) for v in vals):
            continue
        age, lat, lon, angle = (float(v) for v in vals)
        if 0 <= age < start and -90 <= lat <= 90 and -360 <= lon <= 360 and -360 <= angle <= 360:
            out[age] = (age, lat, lon, angle)
    return sorted(out.values())[:500]


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
    start, step = data.get('start', 1000), data.get('step', 10)
    if not _number(start) or not 1 <= start <= OLDEST or not _number(step) or not 1 <= step <= start:
        return error('Bad start age or step.')
    start, step = float(start), float(step)
    plate_names, plate_motion = {}, {}
    for p in data.get('plates') or []:
        if isinstance(p, dict) and _plate_id(p.get('id')):
            plate_names[p['id']] = str(p.get('name') or '')[:80]
            plate_motion[p['id']] = (_plate_id(p.get('fixed')) or 0, _samples(p.get('rotations'), start))

    out, points, plate_ids, rifts = [], 0, set(), []
    for f in feats:
        if not isinstance(f, dict) or f.get('kind') not in KINDS:
            continue
        closed = f['kind'] in CLOSED
        coords = _clean_coords(f.get('coords'), closed)
        if coords is None:
            continue
        points += len(coords)
        if points > MAX_POINTS:
            return error('Too many points.', 413)
        plate_id = _plate_id(f.get('plateId')) or 0
        plate_ids.add(plate_id)
        geometry = pg.PolygonOnSphere(coords) if closed else pg.PolylineOnSphere(coords)
        # when it exists: a rift, trench or arc can begin after the start, and a trench end before the present
        begin = float(f['begin']) if _number(f.get('begin')) and 0 < f['begin'] < start else start
        end = float(f['end']) if _number(f.get('end')) and 0 < f['end'] < begin else pg.GeoTimeInstant.create_distant_future()
        feature = pg.Feature.create_reconstructable_feature(
            pg.FeatureType.create_gpml(KINDS[f['kind']]), geometry,
            name=str(f.get('name') or '')[:120], valid_time=(begin, end), reconstruction_plate_id=plate_id)
        if f['kind'] == 'failed':
            feature.set_description(FAILED)
        if f['kind'] == 'subduction':                              # the side of the overriding plate, as drawn
            feature.set_enumeration(pg.PropertyName.create_gpml(POLARITY), 'Right' if f.get('side') == 'right' else 'Left')
        out.append(feature)
        left, right = _plate_id(f.get('left')), _plate_id(f.get('right'))
        if f['kind'] == 'rift' and left and right and left != right:
            rifts.append((str(f.get('name') or 'Rift')[:120], coords, left, right, plate_id, begin))
            plate_ids.update((left, right))
    if not out:
        return error('No valid shapes to export.')

    # each plate: the identity at the start age (and before), its poles, its youngest pole held to 0 Ma
    ident = pg.FiniteRotation.create_identity_rotation()
    rotations = []
    for pid in sorted((plate_ids | set(plate_motion)) - {0}):
        fixed, samples = plate_motion.get(pid, (0, []))
        label = plate_names.get(pid) or f'Plate {pid}'
        seq = [(start, ident)] + [(age, pg.FiniteRotation((lat, lon), math.radians(angle))) for age, lat, lon, angle in samples]
        if start < OLDEST:
            seq.append((OLDEST, ident))
        youngest = min(seq, key=lambda s: s[0])
        if youngest[0] > 0:
            seq.append((0.0, youngest[1]))
        seq.sort(key=lambda s: s[0])                                # pyGPlates reads them youngest first
        rotations.append(pg.Feature.create_total_reconstruction_sequence(fixed, pid, pg.GpmlIrregularSampling(
            [pg.GpmlTimeSample(pg.GpmlFiniteRotation(r), age, label) for age, r in seq])))

    # flowlines: seeded on each opening rift when it opens, where its two plates still touch
    if rifts:
        model = pg.RotationModel(rotations)
        for rift_name, coords, left, right, plate_id, begin in rifts:
            times = [0.0]
            while times[-1] + step < begin:
                times.append(times[-1] + step)
            times.append(begin)
            # the rift as it lay when it opened (its coordinates are in its plate's own frame)
            turn = model.get_rotation(begin, plate_id) if plate_id else pg.FiniteRotation.create_identity_rotation()
            seeds = pg.MultiPointOnSphere([turn * pg.PointOnSphere(c) for c in coords])
            out.append(pg.Feature.create_flowline(
                seeds, times, name=f'{rift_name} flowline', valid_time=(begin, 0.0),
                left_plate=left, right_plate=right, reverse_reconstruct=(model, begin)))

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
                f'{name}.gpml  cratons, continental crust, rifts (failed rifts: ContinentalRift, description "{FAILED}"),\n'
                '              subduction zones (SubductionZone, with polarity) and island arcs (IslandArc),\n'
                '              each valid from when it forms, and a Flowline for each rift that opens between two plates\n'
                f'{name}.rot   every plate\'s rotation poles, relative to its fixed plate\n\n'
                f'The shapes are the supercontinent as drawn at {start:.0f} Ma, where every rotation is zero.\n'
                'In GPlates: File > Open Feature Collection, open both files, then move the time slider.\n'))
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
        kind = {'Craton': 'craton', 'ContinentalCrust': 'crust', 'ContinentalRift': 'rift', 'SubductionZone': 'subduction', 'IslandArc': 'arc'}.get(ftype)
        if kind is None:
            skipped += 1
            continue
        if kind == 'rift' and FAILED in (feature.get_description() or '').lower():
            kind = 'failed'
        plate_id = feature.get_reconstruction_plate_id(0)
        for geometry in feature.get_geometries():
            closed = isinstance(geometry, pg.PolygonOnSphere)
            if kind in CLOSED and not closed:
                continue
            if kind not in CLOSED and not isinstance(geometry, pg.PolylineOnSphere):
                continue
            coords = [[round(lat, 4), round(lon, 4)] for lat, lon in geometry.to_lat_lon_list()]
            if closed and len(coords) > 3 and coords[0] == coords[-1]:
                coords = coords[:-1]
            points += len(coords)
            if points > MAX_POINTS or len(features) >= MAX_FEATURES:
                return error('Too many shapes or points.', 413)
            item = {'kind': kind, 'plateId': int(plate_id), 'name': feature.get_name() or '', 'coords': coords}
            begin, end = feature.get_valid_time()
            if math.isfinite(begin) and begin < OLDEST:
                item['begin'] = round(begin, 3)
            if math.isfinite(end) and end > 0:
                item['end'] = round(end, 3)
            if kind == 'subduction':
                polarity = feature.get_enumeration(pg.PropertyName.create_gpml(POLARITY), 'Left')
                item['side'] = 'right' if str(polarity).lower() == 'right' else 'left'
            features.append(item)
            plates.setdefault(int(plate_id), {'id': int(plate_id), 'name': f'Plate {plate_id}'})
    return JsonResponse({'features': features, 'plates': list(plates.values()), 'skipped': skipped})
