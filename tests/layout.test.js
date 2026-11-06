// Run with: gjs -m tests/layout.test.js
import {composeShape, nearestSide, pinToEdge, centeredBarWidth} from '../layout.js';

let failures = 0;
function check(name, condition) {
    print(`${condition ? 'ok  ' : 'FAIL'} ${name}`);
    if (!condition)
        failures++;
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const rects = pieces => pieces.filter(p => p.type === 'rect');
const fillets = pieces => pieces.filter(p => p.type === 'fillet');
const base = {monitorW: 1920, monitorH: 1080, radius: 22, flare: 12};

// A top bar in the middle of the screen.
{
    const pieces = composeShape({...base, side: 'top', body: [500, 0, 900, 32]});
    const [body] = rects(pieces);
    check('top: body runs from the edge', eq([body.x, body.y, body.w, body.h], [500, 0, 900, 32]));
    check('top: only the far corners are rounded, fitted to its height', eq(body.radii, [0, 0, 21, 21]));
    check('top: two flares', fillets(pieces).length === 2);
    const [left, right] = fillets(pieces);
    check('top: left flare hollows away from the body and edge', eq(left.hollow, [0, 1]));
    check('top: right flare hollows away from the body and edge', eq(right.hollow, [1, 1]));
    check('top: left flare ends at the body, 1px inside it', left.x === 500 - left.radius && left.x + left.w === 501);
    check('top: right flare starts 1px inside the body', right.x === 1399 && right.x + right.w === 1400 + right.radius);
    check('top: flares start past the edge', left.y === -1 && left.y + left.h === left.radius);
}

// A dock at each edge: the far corners and flares must face the right way.
{
    const [bottom] = rects(composeShape({...base, side: 'bottom', body: [500, 1020, 900, 60]}));
    check('bottom: top corners rounded', eq(bottom.radii, [22, 22, 0, 0]));
    const [fb] = fillets(composeShape({...base, side: 'bottom', body: [500, 1020, 900, 60]}));
    check('bottom: flare hollows upward', eq(fb.hollow, [0, 0]));
    check('bottom: flare ends past the edge', fb.y + fb.h === 1081);

    const [left] = rects(composeShape({...base, side: 'left', body: [0, 200, 60, 600]}));
    check('left: right corners rounded', eq(left.radii, [0, 22, 22, 0]));
    const [fl] = fillets(composeShape({...base, side: 'left', body: [0, 200, 60, 600]}));
    check('left: flare above the body hollows up and right', eq(fl.hollow, [1, 0]));

    const [right] = rects(composeShape({...base, side: 'right', body: [1860, 200, 60, 600]}));
    check('right: left corners rounded', eq(right.radii, [22, 0, 0, 22]));
    check('right: body in place', eq([right.x, right.y, right.w, right.h], [1860, 200, 60, 600]));
    const [fr] = fillets(composeShape({...base, side: 'right', body: [1860, 200, 60, 600]}));
    check('right: flare hollows up and left', eq(fr.hollow, [0, 0]));
}

// Sliding out of the screen.
{
    const pieces = composeShape({...base, side: 'bottom', body: [500, 1075, 900, 5]});
    const shown = rects(pieces)[0].radii[0], flare = fillets(pieces)[0]?.radius ?? 0;
    check('sliding: corner and flare fit in what shows', shown > 0 && shown + flare <= 5);
    const bar = composeShape({...base, side: 'top', body: [500, 0, 900, 32]});
    const barFlare = fillets(bar)[0].radius;
    check('top bar: corner and flare fit its height', rects(bar)[0].radii[2] + barFlare <= 32 && barFlare > 0);
    const tall = composeShape({...base, radius: 6, flare: 30, side: 'top', body: [500, 0, 900, 32]});
    check('top bar: a large flare leaves room for the corner', rects(tall)[0].radii[2] + fillets(tall)[0].radius <= 32);
    check('gone: nothing drawn', composeShape({...base, side: 'bottom', body: [500, 1080, 900, 0]}).length === 0);
}

// No room for a flare at the screen's end.
{
    const pieces = composeShape({...base, side: 'top', body: [0, 0, 1920, 32]});
    check('full width: no flares', fillets(pieces).length === 0);
    const clipped = composeShape({...base, side: 'top', body: [5, 0, 1000, 32]});
    check('near the end: flare limited to the room', fillets(clipped)[0].radius === 5);
}

// A menu out of the middle of the bar.
{
    const growths = [{rect: [800, 28, 300, 400], radius: 20}];
    const pieces = composeShape({...base, side: 'top', body: [500, 0, 900, 32], growths});
    check('menu: a body and a menu', rects(pieces).length === 2);
    const menu = rects(pieces)[1];
    check('menu: far corners rounded only', eq(menu.radii, [0, 0, 20, 20]));
    check('menu: overlaps the body', menu.y < 32 && menu.y + menu.h === 428);
    check('menu: body keeps its corners', eq(rects(pieces)[0].radii, [0, 0, 21, 21]));
    const joins = fillets(pieces).filter(f => f.y === 31);
    check('menu: two fillets on the far side', joins.length === 2 && joins.every(f => f.radius === 12));
    check('menu: fillets hollow away from the body and menu', eq(joins.map(f => f.hollow), [[0, 1], [1, 1]]));
}

// A menu's side coming to the body's end: corner and fillet shrink together, then the two are flush.
{
    const shapeAt = x => composeShape({...base, side: 'top', body: [500, 0, 900, 32],
        growths: [{rect: [x, 28, 300, 400], radius: 20}]});
    const far = shapeAt(600);
    check('far from the end: full fitted corner', rects(far)[0].radii[3] === 21);
    const near = shapeAt(517); // 17 of the 34 the corner and fillet need
    // The bar is 32 tall, so its corner is fitted to 21 and the flare to 11 before the menu halves them.
    check('near the end: corner limited by the menu', rects(near)[0].radii[3] === 11);
    check('near the end: fillet halved', fillets(near).some(f => f.y === 31 && f.radius === 6));
    const flush = shapeAt(500);
    check('flush: square corner', rects(flush)[0].radii[3] === 0);
    check('flush: no fillet on that side', fillets(flush).filter(f => f.y === 31 && f.hollow[0] === 0).length === 0);
    const wide = shapeAt(450);
    check('past the end: body widens to the menu', rects(wide)[0].x === 450 && rects(wide)[0].radii[3] === 0);
    check('past the end: flare moved out with it', fillets(wide)[0].x === 450 - fillets(wide)[0].radius);
}

// A menu just opening: its far side only just past the bar.
{
    const pieces = composeShape({...base, side: 'top', body: [500, 0, 900, 32],
        growths: [{rect: [800, 28, 100, 8], radius: 20}]});
    const menu = rects(pieces)[1];
    const join = fillets(pieces).filter(f => f.y === 31);
    check('opening: corners and fillets fit what shows', menu.radii[2] + (join[0]?.radius ?? 0) <= 4 && menu.radii[2] > 0);
}

// Up out of a dock.
{
    const pieces = composeShape({...base, side: 'bottom', body: [500, 1020, 900, 60],
        growths: [{rect: [800, 700, 300, 324], radius: 20}]});
    const menu = rects(pieces)[1];
    check('dock menu: reaches up', menu.y === 700);
    check('dock menu: top corners rounded', eq(menu.radii, [20, 20, 0, 0]));
    check('dock menu: overlaps the dock', menu.y + menu.h > 1020);
    const joins = fillets(pieces).filter(f => f.y + f.h === 1021);
    check('dock menu: fillets at the dock\'s far side, hollowing up', joins.length === 2 && joins.every(f => f.hollow[1] === 0));
}

check('nearestSide', nearestSide([500, 1000, 900, 80], 1920, 1080) === 'bottom' &&
    nearestSide([500, 0, 900, 32], 1920, 1080) === 'top' &&
    nearestSide([0, 200, 60, 600], 1920, 1080) === 'left' &&
    nearestSide([1860, 200, 60, 600], 1920, 1080) === 'right');
check('pinToEdge top', eq(pinToEdge([100, 8, 50, 32], 'top', 1920, 1080), [100, 0, 50, 40]));
check('pinToEdge top, sliding out', eq(pinToEdge([100, -20, 50, 32], 'top', 1920, 1080), [100, 0, 50, 12]));
check('pinToEdge bottom', eq(pinToEdge([100, 1000, 50, 40], 'bottom', 1920, 1080), [100, 1000, 50, 80]));
check('pinToEdge left', eq(pinToEdge([10, 100, 50, 40], 'left', 1920, 1080), [0, 100, 60, 40]));
check('pinToEdge right', eq(pinToEdge([1800, 100, 50, 40], 'right', 1920, 1080), [1800, 100, 120, 40]));
check('centeredBarWidth', centeredBarWidth(100, 80, 300, 0) === 680 && centeredBarWidth(100, 80, 300, -20) === 700);

print(failures ? `${failures} failed` : 'all passed');
import('system').then(system => system.exit(failures ? 1 : 0));
