import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {EdgeBar} from './bar.js';
import {isActorValid} from './frames.js';
import {centeredBarWidth, nearestSide, pinToEdge} from './layout.js';

const TRANSPARENT = 'simple-gnome-shell-transparent';
// Inline styles win over the stylesheet, and Multi Monitors Bar colors its bars with one.
const PANEL_STYLE = 'background-color: transparent !important;';

// Built like the shell's Panel, as Multi Monitors Bar's panels are.
function isTopBar(actor) {
    return actor instanceof St.Widget &&
        actor._leftBox instanceof St.BoxLayout &&
        actor._centerBox instanceof St.BoxLayout &&
        actor._rightBox instanceof St.BoxLayout;
}

// What this extension adds to a panel's inline style: the color, and the height if one is set.
const OWN_PANEL_STYLE = /background-color: transparent !important;( height: \d+px; min-height: \d+px;)?/;

function withoutPanelStyle(style) {
    return (style ?? '').replace(OWN_PANEL_STYLE, '').trim().replace(/;$/, '');
}

/** The shape behind one top bar. */
class TopBar extends EdgeBar {
    constructor(settings, frames, panel, panelBox, main) {
        super(settings, 'top-bar-radius', 'top-bar-flare');
        this.isTopBar = true;
        this._panel = panel;
        this._panelBox = panelBox;
        this._main = main;
        this._centeredWidth = 0;
        this._applying = false;
        this._style = '';

        panel.add_style_class_name(TRANSPARENT);
        this._boxes = [panel._leftBox, panel._rightBox];
        this._boxStyles = this._boxes.map(box => box.get_style());
        this._applyPanelStyle();
        // Multi Monitors Bar sets a new panel color with an inline style of its own.
        this._panelStyleId = panel.connect('style-changed', () => this._applyPanelStyle());
        this._applyPadding();
        this._applyBarStyle();

        const ids = ['top-bar-style', 'top-bar-margin', 'top-bar-padding', 'menus-grow', 'notifications-grow', 'osd-grow'];
        this._ownIds = ids.map(key => settings.connect(`changed::${key}`, () => {
            this._applyPadding();
            this._applyBarStyle();
        }));
        this._ownIds.push(settings.connect('changed::top-bar-height', () => this._applyPanelStyle()));
        // Read on the next frame, which this asks for.
        this._ownIds.push(settings.connect('changed::top-bar-width', () => this._panel.queue_relayout()));
        this._removeFrames = frames.add(() => this._sync());
    }

    /** The monitor the bar is on: Multi Monitors Bar's panels carry it, and the shell's own bar is the primary's. */
    get monitorIndex() {
        return this._panel.monitorIndex ?? Main.layoutManager.primaryIndex;
    }

    /** The bar's status area button `name` (dateMenu, quickSettings...), or null. */
    button(name) {
        return this._panel.statusArea?.[name] ?? null;
    }

    growsFrom(source, key) {
        return this.drawn && this._settings.get_boolean(`${key}-grow`) &&
            isActorValid(source) && source.mapped && this._panel.contains(source);
    }

    // The notification center and a centered bar share their width. Across the monitor, it would fill the screen.
    menuSpan(menu) {
        if (!this.drawn || !this._isCentered() || this.button('dateMenu')?.menu !== menu)
            return null;
        return [this._monitor.x + this._body[0], this._body[2]];
    }

    _applyPanelStyle() {
        if (this._applying)
            return;
        const style = this._panel.get_style() ?? '';
        const height = this._settings.get_int('top-bar-height');
        const added = height > 0 ? `${PANEL_STYLE} height: ${height}px; min-height: ${height}px;` : PANEL_STYLE;
        const own = withoutPanelStyle(style);
        const wanted = own ? `${own}; ${added}` : added;
        if (style === wanted)
            return;
        this._applying = true;
        this._panel.set_style(wanted);
        this._applying = false;
        this._alignInBox(height > 0);
    }

    // Multi Monitors Bar's boxes keep the height the main bar had when they were made, and its bars fill them. A bar of
    // a chosen height sits at the top of its box instead.
    _alignInBox(fixed) {
        if (this._main || fixed === this._alignedInBox)
            return;
        this._alignedInBox = fixed;
        if (fixed) {
            this._savedY = [this._panel.y_expand, this._panel.y_align];
            this._panel.y_expand = false;
            this._panel.y_align = Clutter.ActorAlign.START;
        } else if (this._savedY) {
            [this._panel.y_expand, this._panel.y_align] = this._savedY;
        }
    }

    _applyPadding() {
        const padding = this._settings.get_int('top-bar-padding');
        this._boxes.forEach((box, i) => {
            const own = this._boxStyles[i]?.trim().replace(/;$/, '');
            const extra = `padding-${i ? 'right' : 'left'}: ${padding}px;`;
            box.set_style(own ? `${own}; ${extra}` : extra);
        });
    }

    _isCentered() {
        return this._settings.get_string('top-bar-style') === 'center';
    }

    _applyBarStyle() {
        const centered = this._isCentered();
        if (centered === this._wasCentered)
            return;
        this._wasCentered = centered;
        const panel = this._panel;
        if (centered) {
            // panelBox keeps the monitor's width, so the strut and the work area stay as they are.
            this._savedAlign = panel.x_align;
            panel.x_align = Clutter.ActorAlign.CENTER;
        } else {
            panel.width = -1;
            panel.x_align = this._savedAlign ?? Clutter.ActorAlign.FILL;
            this._centeredWidth = 0;
        }
        // Quick settings opens from its button's left edge and counts on the screen edge to push it back, so in the
        // middle of the screen it would hang past the bar. The other monitors' bars open this same menu.
        const quickSettings = this._main ? Main.panel.statusArea.quickSettings?.menu : null;
        if (quickSettings) {
            if (centered) {
                this._savedAlignment = quickSettings._arrowAlignment;
                quickSettings._arrowAlignment = 0.5;
            } else if (this._savedAlignment !== undefined) {
                quickSettings._arrowAlignment = this._savedAlignment;
            }
        }
    }

    _fitCenteredWidth(maxWidth, monitor) {
        const panel = this._panel;
        const natural = box => box.get_preferred_width(-1)[1];
        // Panel adds the work area's offset when it centers its middle box, as for a dock fixed to a side.
        const workArea = Main.layoutManager.getWorkAreaForMonitor(monitor.index);
        const centerOffset = 2 * (workArea.x - monitor.x) + workArea.width - monitor.width;
        const fitted = centeredBarWidth(natural(panel._leftBox), natural(panel._centerBox), natural(panel._rightBox),
            centerOffset);
        // A chosen width spreads the buttons apart, but never squeezes them.
        const width = Math.min(maxWidth, Math.max(fitted, this._settings.get_int('top-bar-width')));
        if (width !== this._centeredWidth) {
            this._centeredWidth = width;
            panel.width = width;
        }
        return width;
    }

    // Below the panel. While banners grow out of the main bar, also below the message tray, which the shell keeps far
    // below the panel: the banners are drawn over the shape then, not under it.
    _stack() {
        const uiGroup = Main.layoutManager.uiGroup;
        const tray = Main.messageTray;
        let below = this._panelBox;
        if (this._main && this._settings.get_boolean('notifications-grow') && tray.get_parent() === uiGroup)
            below = tray;
        this.shape.stackBelow(below);
    }

    _sync() {
        const panel = this._panel, panelBox = this._panelBox;
        // Lays the stage out now if this bar waits for it, so the reads below see this frame's allocations. On a bar
        // queued for relayout, size getters re-measure part of its tree mid-frame, and Multi Monitors Bar's mirrored
        // buttons then miss their next resize.
        const allocation = panel.get_allocation_box();
        this._stack();
        const monitor = Main.layoutManager.monitors[this.monitorIndex];
        if (!monitor || !panelBox.visible || !panelBox.mapped || !panel.mapped) {
            this.setBody(monitor, 'top', null, 0);
            return;
        }
        const [x, y] = panelBox.get_transformed_position();
        const width = Math.round(panelBox.allocation.get_width());
        const height = Math.round(allocation.get_height());
        if (!Number.isFinite(x) || !Number.isFinite(y) || width < 1 || height < 1)
            return;

        let left = x - monitor.x, barWidth;
        if (this._isCentered()) {
            barWidth = this._fitCenteredWidth(width, monitor);
            // Where panelBox puts the bar once it lays out, so the shape does not lag a frame behind.
            left += Math.floor((width - barWidth) / 2);
        } else {
            const margin = this._settings.get_int('top-bar-margin');
            left += margin;
            barWidth = width - margin * 2;
        }
        const rect = [left, y - monitor.y, barWidth, height];
        // Where it rests decides the edge, not where a slide has it now.
        const atRest = [left, panelBox.y - monitor.y, barWidth, height];
        const side = nearestSide(atRest, monitor.width, monitor.height) === 'bottom' ? 'bottom' : 'top';
        const body = pinToEdge(rect, side, monitor.width, monitor.height);
        const thickness = body[3];
        const opacity = Math.round(panelBox.opacity * panel.opacity / 255);
        this.setBody(monitor, side, thickness > 0 ? body : null, opacity);
    }

    destroy() {
        this._removeFrames();
        for (const id of this._ownIds)
            this._settings.disconnect(id);
        super.destroy();
        const panel = this._panel;
        if (!isActorValid(panel))
            return;
        panel.disconnect(this._panelStyleId);
        this._alignInBox(false);
        panel.remove_style_class_name(TRANSPARENT);
        panel.set_style(withoutPanelStyle(panel.get_style()) || null);
        this._boxes.forEach((box, i) => box.set_style(this._boxStyles[i]));
        if (this._wasCentered) {
            panel.width = -1;
            panel.x_align = this._savedAlign;
            const quickSettings = this._main ? Main.panel.statusArea.quickSettings?.menu : null;
            if (quickSettings && this._savedAlignment !== undefined)
                quickSettings._arrowAlignment = this._savedAlignment;
        }
    }
}

/** Keeps a shape behind the shell's top bar and the bars other extensions build for further monitors. */
export class TopBars {
    constructor(settings, frames) {
        this._settings = settings;
        this._frames = frames;
        this._bars = new Map();
        this._watched = new Map();
        this._idleId = 0;
        const uiGroup = Main.layoutManager.uiGroup;
        const scan = () => this._schedule();
        this._disconnects = ['child-added', 'child-removed'].map(signal => {
            const id = uiGroup.connect(signal, scan);
            return () => uiGroup.disconnect(id);
        });
        const monitorsId = Main.layoutManager.connect('monitors-changed', scan);
        const extensionsId = Main.extensionManager.connect('extension-state-changed', scan);
        const settingsId = settings.connect('changed::top-bar-enabled', scan);
        this._disconnects.push(
            () => Main.layoutManager.disconnect(monitorsId),
            () => Main.extensionManager.disconnect(extensionsId),
            () => settings.disconnect(settingsId));
        this._scan();
    }

    // A bar's box is added to uiGroup before the bar is put in it: the scan waits for an idle.
    _schedule() {
        if (this._idleId)
            return;
        this._idleId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._idleId = 0;
            this._scan();
            return GLib.SOURCE_REMOVE;
        });
    }

    _scan() {
        const wanted = new Map();
        const present = new Set();
        const enabled = this._settings.get_boolean('top-bar-enabled');
        for (const box of Main.layoutManager.uiGroup.get_children()) {
            if (!(box instanceof St.Widget))
                continue;
            for (const child of box.get_children()) {
                if (!isTopBar(child))
                    continue;
                present.add(child);
                // Bars along a side of the screen are left alone. Multi Monitors Bar marks them.
                if (enabled && !child.has_style_class_name('multimonitor-panel-vertical'))
                    wanted.set(child, box);
            }
        }
        for (const panel of [...this._bars.keys()]) {
            if (!wanted.has(panel))
                this._detach(panel);
        }
        for (const panel of [...this._watched.keys()]) {
            if (!present.has(panel))
                this._unwatch(panel);
        }
        for (const panel of present) {
            if (!this._watched.has(panel))
                this._watch(panel);
        }
        for (const [panel, box] of wanted) {
            if (this._bars.has(panel))
                continue;
            // These bars may belong to other extensions, and may not be built the way TopBar expects.
            try {
                this._bars.set(panel, new TopBar(this._settings, this._frames, panel, box, panel === Main.panel));
            } catch (e) {
                logError(e, '[Simple GNOME Shell] could not attach to a top bar');
            }
        }
    }

    _watch(panel) {
        // The shape and the styles must go while the bar's actors still exist.
        const destroyId = panel.connect('destroy', () => this._unwatch(panel));
        // Multi Monitors Bar moves a bar to a side of the screen, and back, by its style class alone.
        const styleId = panel.connect('notify::style-class', () => this._schedule());
        this._watched.set(panel, [destroyId, styleId]);
    }

    // Disconnects first: detaching changes the bar's style class, which would queue a scan.
    _unwatch(panel) {
        for (const id of this._watched.get(panel) ?? [])
            panel.disconnect(id);
        this._watched.delete(panel);
        this._detach(panel);
    }

    _detach(panel) {
        const bar = this._bars.get(panel);
        if (!bar)
            return;
        this._bars.delete(panel);
        bar.destroy();
    }

    destroy() {
        if (this._idleId) {
            GLib.source_remove(this._idleId);
            this._idleId = 0;
        }
        for (const disconnect of this._disconnects)
            disconnect();
        this._disconnects = [];
        for (const panel of [...this._watched.keys()])
            this._unwatch(panel);
    }
}
