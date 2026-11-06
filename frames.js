import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Meta from 'gi://Meta';

// Stage views each emit before-update: a frame shown on two monitors in the same moment counts once.
const SAME_FRAME_US = 2000;

/**
 * Runs its clients once per stage update, before layout and paint. It follows the stage's own frames, so it costs
 * nothing while the screen does not change.
 */
export class Frames {
    constructor() {
        this._clients = new Set();
        this._last = 0;
        this._reported = new Set();
        this._id = global.stage.connect('before-update', () => this._tick());
    }

    /** Adds `client`. Returns the function that removes it. */
    add(client) {
        this._clients.add(client);
        return () => this._clients.delete(client);
    }

    _tick() {
        const now = GLib.get_monotonic_time();
        if (now - this._last < SAME_FRAME_US)
            return;
        this._last = now;
        for (const client of this._clients) {
            try {
                client();
            } catch (e) {
                // Once per client: this runs on every frame.
                if (!this._reported.has(client)) {
                    this._reported.add(client);
                    logError(e, '[Simple GNOME Shell] frame client failed');
                }
            }
        }
    }

    destroy() {
        global.stage.disconnect(this._id);
        this._clients.clear();
    }
}

const tickers = new Map();
let nextTicker = 0;

/**
 * Calls `cb` before every redraw for as long as it returns true, asking for those redraws. An animation runs on this,
 * so it goes on even on frames where none of its actors happen to change. Returns an id for removeTicker().
 */
export function addTicker(cb) {
    const id = ++nextTicker;
    const ticker = {laterId: 0, last: 0};
    tickers.set(id, ticker);
    const schedule = () => {
        ticker.laterId = global.compositor.get_laters().add(Meta.LaterType.BEFORE_REDRAW, () => {
            ticker.laterId = 0;
            if (tickers.get(id) !== ticker)
                return GLib.SOURCE_REMOVE;
            let keep = true;
            const now = GLib.get_monotonic_time();
            if (now - ticker.last >= SAME_FRAME_US) {
                ticker.last = now;
                try {
                    keep = !!cb();
                } catch (e) {
                    keep = false;
                    logError(e, '[Simple GNOME Shell] animation failed');
                }
            }
            if (tickers.get(id) !== ticker)
                return GLib.SOURCE_REMOVE;
            if (keep)
                schedule();
            else
                tickers.delete(id);
            return GLib.SOURCE_REMOVE;
        });
    };
    schedule();
    return id;
}

export function removeTicker(id) {
    const ticker = tickers.get(id);
    if (!ticker)
        return;
    tickers.delete(id);
    if (ticker.laterId)
        global.compositor.get_laters().remove(ticker.laterId);
}

const gobjectToString = GObject.Object.prototype.toString;

/**
 * Whether `actor` is still alive. A disposed wrapper neither throws nor returns undefined in gjs (it logs a critical
 * and returns the property's default), so this is the only reliable test.
 */
export function isActorValid(actor) {
    if (!actor)
        return false;
    const desc = gobjectToString.call(actor);
    return !desc.includes('(DISPOSED)') && !desc.includes('(FINALIZED)') && typeof actor.visible === 'boolean';
}
