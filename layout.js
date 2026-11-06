// The geometry of a shape grown out of a screen edge, free of any shell imports so it can be tested with plain gjs.
//
// composeShape() works in a frame where the edge is the top of the screen (y = 0) and maps the result back to the
// monitor. The body runs from the edge to its far side. Its corners on the far side are rounded, and it joins the edge
// through concave flares. Menus leave the far side through concave fillets. Where a menu's side comes close to the
// body's end, the body's corner and the fillet shrink together, so the outline stays closed, until the two are flush.

function frameOf(side, W, H) {
    switch (side) {
    case 'bottom':
        return {
            length: W,
            rect: ([x, y, w, h]) => [x, H - y - h, x + w, H - y],
            unrect: ([x0, y0, x1, y1]) => [x0, H - y1, x1 - x0, y1 - y0],
            radii: (nl, nr, fr, fl) => [fl, fr, nr, nl],
            point: (x, y) => [x, H - y],
        };
    case 'left':
        return {
            length: H,
            rect: ([x, y, w, h]) => [y, x, y + h, x + w],
            unrect: ([x0, y0, x1, y1]) => [y0, x0, y1 - y0, x1 - x0],
            radii: (nl, nr, fr, fl) => [nl, fl, fr, nr],
            point: (x, y) => [y, x],
        };
    case 'right':
        return {
            length: H,
            rect: ([x, y, w, h]) => [y, W - x - w, y + h, W - x],
            unrect: ([x0, y0, x1, y1]) => [W - y1, x0, y1 - y0, x1 - x0],
            radii: (nl, nr, fr, fl) => [fl, nl, nr, fr],
            point: (x, y) => [W - y, x],
        };
    default:
        return {
            length: W,
            rect: ([x, y, w, h]) => [x, y, x + w, y + h],
            unrect: ([x0, y0, x1, y1]) => [x0, y0, x1 - x0, y1 - y0],
            radii: (nl, nr, fr, fl) => [nl, nr, fr, fl],
            point: (x, y) => [x, y],
        };
    }
}

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

/**
 * The corner and the flare of a side as long as `room`, whole px. Each takes a stretch of that side, so together they
 * fit in it, in proportion, or the two curves would run into each other and leave a notch.
 */
function fitCurves(corner, flare, room) {
    const total = corner + flare;
    const k = total > room ? Math.max(room, 0) / total : 1;
    const fittedCorner = Math.round(corner * k);
    return [fittedCorner, Math.min(Math.round(flare * k), Math.max(Math.floor(room) - fittedCorner, 0))];
}

/** The side of a monitor of size W x H that the rect [x, y, w, h], local to it, is closest to. */
export function nearestSide([x, y, w, h], W, H) {
    const cx = x + w / 2, cy = y + h / 2;
    const least = Math.min(cy, H - cy, cx, W - cx);
    if (least === H - cy)
        return 'bottom';
    if (least === cy)
        return 'top';
    return least === W - cx ? 'right' : 'left';
}

/**
 * The rect local to the monitor with its side on `side` moved on to the monitor's edge. The far side stays where it
 * is, so a bar sliding out of the screen draws its shape back into the edge.
 */
export function pinToEdge([x, y, w, h], side, W, H) {
    switch (side) {
    case 'bottom':
        return [x, y, w, H - y];
    case 'left':
        return [0, y, x + w, h];
    case 'right':
        return [x, y, W - x, h];
    default:
        return [x, 0, w, y + h];
    }
}

/**
 * The width at which the shell's Panel fits its boxes at their natural widths. It puts the center box in the middle
 * and gives both sides the same room, shifted by the work area's offset when a dock is fixed to a side.
 */
export function centeredBarWidth(left, center, right, centerOffset) {
    return Math.ceil(center + 2 * Math.max(left, right) + Math.abs(centerOffset));
}

/**
 * The pieces that draw a shape, local to the monitor (`monitorW` x `monitorH`).
 *
 * `body` is [x, y, w, h], already reaching the edge on `side`. `growths` are the things grown out of it, each
 * { rect: [x, y, w, h], radius }, with `fillet` the radius of their joins. Returns a list of
 *   { type: 'rect', x, y, w, h, radii: [top left, top right, bottom right, bottom left] }
 *   { type: 'fillet', x, y, w, h, radius, hollow: [0 left | 1 right, 0 top | 1 bottom] }
 * in whole pixels. A fillet is a filled square with a quarter circle of `radius` taken out of its `hollow` corner.
 * The pieces overlap by a pixel so no seam shows; the caller paints them as one group.
 */
export function composeShape({side, monitorW, monitorH, body, radius, flare, fillet = flare, growths = []}) {
    const frame = frameOf(side, monitorW, monitorH);
    const pieces = [];
    const [x0, , x1, thick] = frame.rect(body).map(Math.round);
    if (!(x1 - x0 >= 1) || !(thick >= 1))
        return pieces;

    const addRect = (rx0, ry0, rx1, ry1, near, far) => {
        if (rx1 <= rx0 || ry1 <= ry0)
            return;
        const [x, y, w, h] = frame.unrect([rx0, ry0, rx1, ry1]);
        pieces.push({type: 'rect', x, y, w, h, radii: frame.radii(near, near, far[0], far[1])});
    };
    // A join at (sideX, edgeY), filling outwards from the side by `f`: dir -1 to the left of it, 1 to the right.
    const addFillet = (sideX, edgeY, dir, f) => {
        if (!(f >= 1))
            return;
        const hx = sideX + dir * f, hy = edgeY + f;
        const sx0 = Math.min(hx, sideX - dir), sx1 = Math.max(hx, sideX - dir);
        const [x, y, w, h] = frame.unrect([sx0, edgeY - 1, sx1, hy]);
        const [px, py] = frame.point(hx, hy);
        pieces.push({
            type: 'fillet', x, y, w, h, radius: f,
            hollow: [px > x + w / 2 ? 1 : 0, py > y + h / 2 ? 1 : 0],
        });
    };

    // What the menus leave of the body's ends.
    let left = x0, right = x1;
    let rLeft = radius, rRight = radius;
    const menus = [];
    for (const {rect, radius: menuRadius} of growths) {
        const [m0, my0, m1, my1] = frame.rect(rect).map(Math.round);
        const gx0 = clamp(m0, 0, frame.length), gx1 = clamp(m1, 0, frame.length);
        if (gx1 - gx0 < 1 || my1 <= my0)
            continue;
        const reach = my1 - thick;
        const width = gx1 - gx0;
        const [menuCorner, f] = fitCurves(Math.min(menuRadius, width / 2), fillet, reach);
        const room = Math.max(radius + f, 1);
        // How much of the corner and the fillet fit between the menu's side and the body's end, 0 to 1.
        const fitLeft = clamp((gx0 - x0) / room, 0, 1), fitRight = clamp((x1 - gx1) / room, 0, 1);
        rLeft = Math.min(rLeft, radius * fitLeft);
        rRight = Math.min(rRight, radius * fitRight);
        left = Math.min(left, gx0);
        right = Math.max(right, gx1);
        menus.push({
            gx0, gx1, y0: Math.min(my0, thick - 1), y1: my1, reach,
            radius: menuCorner,
            filletLeft: f * fitLeft, filletRight: f * fitRight,
        });
    }

    // What shows of the body shrinks as a bar slides out, and the curves with it.
    const [corner, f] = fitCurves(Math.min(radius, (right - left) / 2), flare, thick);
    addRect(left, 0, right, thick, 0, [Math.min(rRight, corner), Math.min(rLeft, corner)]);
    addFillet(left, 0, -1, Math.min(f, left));
    addFillet(right, 0, 1, Math.min(f, frame.length - right));
    for (const menu of menus) {
        addRect(menu.gx0, menu.y0, menu.gx1, menu.y1, 0, [menu.radius, menu.radius]);
        addFillet(menu.gx0, thick, -1, Math.min(menu.filletLeft, menu.gx0));
        addFillet(menu.gx1, thick, 1, Math.min(menu.filletRight, frame.length - menu.gx1));
    }
    return pieces;
}
