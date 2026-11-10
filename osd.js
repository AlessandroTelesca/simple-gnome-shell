import Clutter from 'gi://Clutter';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {isActorValid} from './frames.js';
import {BarGrowth, topBarOnMonitor} from './growth.js';
import {topBarsHidden} from './topBar.js';
import {EdgeTab} from './tab.js';

const TRANSPARENT = 'simple-gnome-shell-transparent';
// The popup sits under the bar's system indicators, kept this far (px) inside the monitor and off the bar.
const MONITOR_GAP = 12;
const BAR_GAP = 6;

function stageRect(actor) {
    const [x, y] = actor.get_transformed_position();
    const [w, h] = actor.get_transformed_size();
    return [x, y, w, h];
}

/** One monitor's volume and brightness popup. */
class OsdPopup {
    constructor(settings, frames, win) {
        this._settings = settings;
        this._win = win;
        this._box = win._hbox;
        this._atTop = false;
        this._barShown = false;
        this._grew = false;
        this._tab = new EdgeTab(settings);
        // Volume and brightness belong to the bar's system indicators.
        const indicators = () => topBarOnMonitor(win._monitorIndex)?.button('quickSettings') ?? null;
        this._indicators = indicators;
        this._growth = new BarGrowth({
            key: 'osd',
            content: () => this._box,
            shown: () => win.visible && win.mapped,
            scale: () => 1,
            source: indicators,
            button: () => {
                const button = indicators();
                if (!button?.mapped)
                    return null;
                const rect = stageRect(button);
                return rect.every(Number.isFinite) && rect[2] > 0 ? rect : null;
            },
            radius: () => settings.get_double('surface-radius'),
            // GNOME fades the popup in; the growth brings it instead. Its fade out is left as it is.
            hold: opening => {
                const ease = opening ? win.get_transition('opacity') : null;
                if (ease)
                    ease.set_from(ease.get_interval().peek_final_value());
            },
            closed: () => {},
        });
        this._box.add_style_class_name(TRANSPARENT);
        this._removeFrames = frames.add(() => this._sync());
    }

    // Moves the popup from GNOME's place at the bottom to under the bar's system indicators, or to the top of the
    // screen while the bar is hidden or its buttons are in the dock. The window moves, not the popup's box, whose
    // translation the growth slides.
    _place(bar, atTop) {
        const win = this._win, box = this._box;
        if (atTop !== this._atTop) {
            this._atTop = atTop;
            win.y_align = atTop ? Clutter.ActorAlign.START : Clutter.ActorAlign.END;
            if (!atTop)
                win.set_translation(0, 0, 0);
            if (atTop)
                box.add_style_class_name(TRANSPARENT);
            else
                box.remove_style_class_name(TRANSPARENT);
        }
        this._barShown = false;
        if (!atTop || !win.visible)
            return;
        const monitor = Main.layoutManager.monitors[win._monitorIndex];
        if (!monitor)
            return;
        const indicators = bar?.button('quickSettings');
        this._barShown = !!indicators && bar.growsFrom(indicators, 'osd');
        const top = (this._barShown ? bar.glassEdge() : monitor.y) + BAR_GAP;
        let center = monitor.x + monitor.width / 2;
        if (indicators?.mapped) {
            const [x, , w] = stageRect(indicators);
            if (Number.isFinite(x))
                center = x + w / 2;
        }
        const w = box.get_allocation_box().get_width();
        const left = Math.min(Math.max(center - w / 2, monitor.x + MONITOR_GAP),
            monitor.x + monitor.width - w - MONITOR_GAP);
        const winBox = win.get_allocation_box(), boxBox = box.get_allocation_box();
        const tx = Math.round(left - (winBox.x1 + boxBox.x1));
        const ty = Math.round(top - (winBox.y1 + boxBox.y1));
        if (Number.isFinite(tx) && Number.isFinite(ty) && (win.translation_x !== tx || win.translation_y !== ty))
            win.set_translation(tx, ty, 0);
    }

    // The popup grows as GNOME shows it and runs back in once GNOME's timeout has started the fade out. True while the
    // bar draws its background.
    _syncGrowth() {
        const win = this._win, growth = this._growth;
        const shown = win.visible && win.mapped;
        const hiding = shown && !win._hideTimeoutId;
        if (shown && !hiding && !(growth.holding && growth.opening))
            growth.start(true);
        else if (!(shown && !hiding) && growth.holding && growth.opening)
            growth.retract();
        const barHolds = shown && !hiding ? growth.holdAtRest() : growth.holding;
        this._grew ||= barHolds;
        if (!shown && !growth.holding)
            this._grew = false;
        return barHolds || (this._grew && hiding);
    }

    _sync() {
        const win = this._win;
        if (!isActorValid(win))
            return;
        const wanted = this._settings.get_boolean('osd-grow');
        const bar = wanted ? topBarOnMonitor(win._monitorIndex) : null;
        this._place(bar, wanted && (!!bar || topBarsHidden()));
        if (bar && this._syncGrowth()) {
            this._tab.hide();
            return;
        }
        if (!bar && this._growth.holding)
            this._growth.release();
        const opacity = win.visible && win.mapped ? Math.min(win.opacity, this._box.opacity) : 0;
        const monitor = Main.layoutManager.monitors[win._monitorIndex];
        if (!this._atTop || opacity === 0 || !monitor) {
            this._tab.hide();
            return;
        }
        // Up at the top while the bar is hidden, the popup's shape grows out of the screen's top edge.
        const rect = stageRect(this._box);
        if (!rect.every(Number.isFinite) || !(rect[2] > 0) || !(rect[3] > 0)) {
            this._tab.hide();
            return;
        }
        this._tab.place(rect, 'top', monitor, win, this._settings.get_double('surface-radius'), opacity);
    }

    destroy() {
        this._removeFrames();
        this._growth.release();
        this._tab.destroy();
        if (!isActorValid(this._win))
            return;
        this._box.remove_style_class_name(TRANSPARENT);
        this._win.y_align = Clutter.ActorAlign.END;
        this._win.set_translation(0, 0, 0);
    }
}

/** Every monitor's popup. The shell rebuilds them when the monitors change. */
export class Osds {
    constructor(settings, frames) {
        this._settings = settings;
        this._frames = frames;
        this._popups = [];
        this._monitorsId = Main.layoutManager.connect('monitors-changed', () => this._rebuild());
        this._rebuild();
    }

    _rebuild() {
        for (const popup of this._popups)
            popup.destroy();
        const windows = Main.osdWindowManager._osdWindows ?? [];
        this._popups = windows.filter(win => win?._hbox).map(win => new OsdPopup(this._settings, this._frames, win));
    }

    destroy() {
        Main.layoutManager.disconnect(this._monitorsId);
        for (const popup of this._popups)
            popup.destroy();
        this._popups = [];
    }
}
