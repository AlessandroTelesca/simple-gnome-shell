import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {ExtensionState} from 'resource:///org/gnome/shell/misc/extensionUtils.js';

import {findDash} from './dock.js';
import {isActorValid} from './frames.js';
import {GeneratedStylesheet} from './generatedStyle.js';
import {setTopBarsHidden} from './topBar.js';

const BAR_CLASS = 'simple-gnome-shell-dock-bar';
// The entry of the order that stands for the dock's apps: what is before it goes left of them, the rest right.
const APPS = 'apps';
// Dock Tray moves these into the dock itself. Without it they go along, unlisted, next to the apps on the right.
const TRAY_ROLE = 'appindicator-';
const DOCK_TRAY_UUID = 'dock-tray@alessandrot';
const ACTIVE = ExtensionState.ACTIVE ?? ExtensionState.ENABLED;
// Dash to Dock builds its new docks right after it tears the old ones down. The top bar stays hidden in between, and
// comes back only if no dock is there after this long.
const RESCAN_MS = 1000;
// A button's highlight is this high (px), in the middle of the dock; the button takes the pointer across the whole dock.
const PILL = 40;
const MIN_BORDER = 3;

const HORIZONTAL = ['top', 'bottom'];

/**
 * The "top bar in the dock" mode: while a dock runs along the top or bottom of a monitor, the top bar's buttons sit in
 * it, on both sides of the apps, and the top bars are hidden. The buttons keep their menus, which then grow out of the
 * dock. Without such a dock the buttons are in the top bar, which shows.
 *
 * There is one set of buttons. With docks on several monitors they are in one of them, the host, and move into a dock
 * as the pointer comes onto its ends. The other docks show clones.
 */
export class DockBar {
    constructor(settings, frames) {
        this._settings = settings;
        this._slots = []; // {root, container, dash, left, right} per dock
        this._host = null;
        this._origins = new Map(); // button container -> {parent, index, side, destroyId}
        this._menus = new Map(); // indicator -> {menu, id, ownOpen, lastY}
        this._idleId = 0;
        this._timeoutId = 0;
        this._syncIdleId = 0;
        this._moveLaterId = 0;
        this._closeIdleId = 0;
        this._menuAnnounced = false;
        this._announcedDash = null;
        this._syncing = false;
        this._border = 0;
        this._style = new GeneratedStylesheet('dock-bar.css');

        this._panelBoxes = [Main.panel._leftBox, Main.panel._centerBox, Main.panel._rightBox];
        const uiGroup = Main.layoutManager.uiGroup;
        const schedule = () => this._schedule();
        const groupIds = ['child-added', 'child-removed'].map(signal => uiGroup.connect(signal, schedule));
        // Other extensions add buttons to the top bar at any time, and some put theirs back in it.
        const boxIds = this._panelBoxes.map(box => box.connect('child-added', () => this._queueSync()));
        const settingsIds = [
            settings.connect('changed::top-bar-in-dock', () => this._scan(true)),
            settings.connect('changed::dock-bar-order', () => this._syncButtons()),
        ];
        const extensionsId = Main.extensionManager.connect('extension-state-changed', schedule);
        this._disconnects = [
            () => groupIds.forEach(id => uiGroup.disconnect(id)),
            () => this._panelBoxes.forEach((box, i) => isActorValid(box) && box.disconnect(boxIds[i])),
            () => settingsIds.forEach(id => settings.disconnect(id)),
            () => Main.extensionManager.disconnect(extensionsId),
        ];
        this._removeFrames = frames.add(() => this._frame());
        this._scan(true);
    }

    // --- The docks -----------------------------------------------------------------------------------------------

    _schedule() {
        if (!this._idleId) {
            this._idleId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                this._idleId = 0;
                this._scan(false);
                return GLib.SOURCE_REMOVE;
            });
        }
        if (this._timeoutId)
            return;
        this._timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, RESCAN_MS, () => {
            this._timeoutId = 0;
            this._scan(true);
            return GLib.SOURCE_REMOVE;
        });
    }

    // `final` says no dock is on its way: without one, the top bar comes back.
    _scan(final) {
        const wanted = this._settings.get_boolean('top-bar-in-dock');
        const found = new Map();
        if (wanted) {
            for (const root of Main.layoutManager.uiGroup.get_children()) {
                if (root.get_name() !== 'dashtodockContainer' || !HORIZONTAL.some(side => root.has_style_class_name(side)))
                    continue;
                const container = findDash(root);
                if (container && isActorValid(container.get_parent()))
                    found.set(container, root);
            }
        }
        for (const slot of [...this._slots]) {
            if (!found.has(slot.container))
                this._removeSlot(slot);
        }
        for (const [container, root] of found) {
            if (!this._slots.some(slot => slot.container === container))
                this._addSlot(root, container);
        }
        if (this._slots.length) {
            const primary = Main.layoutManager.primaryIndex;
            this._host ??= this._slots.find(slot => (slot.root.monitorIndex ?? primary) === primary) ?? this._slots[0];
            setTopBarsHidden(true);
            this._syncButtons();
        } else {
            this._restoreAll();
            if (final || !wanted)
                setTopBarsHidden(false);
        }
    }

    _addSlot(root, container) {
        const box = side => new St.BoxLayout({
            style_class: `${BAR_CLASS} ${side}`,
            // Set, so the buttons' own wish to expand does not reach the dock.
            x_expand: false,
            y_expand: true,
            y_align: Clutter.ActorAlign.FILL,
            reactive: true,
            track_hover: true,
        });
        const slot = {root, container, dash: container.get_parent(), left: box('left'), right: box('right')};
        for (const end of [slot.left, slot.right]) {
            // Not from inside the crossing event: Clutter is still picking the actors that would move.
            end.connect('notify::hover', () => {
                if (end.hover && slot !== this._host)
                    this._queueMove();
            });
            // Dash to Dock tears its docks down on settings and monitor changes. Handlers run before Clutter destroys
            // the children, so the buttons are back in the top bar before they would go with the dock.
            end.connect('destroy', () => this._onSlotDestroyed(slot));
        }
        container.insert_child_at_index(slot.left, 0);
        container.add_child(slot.right);
        this._slots.push(slot);
    }

    _onSlotDestroyed(slot) {
        const index = this._slots.indexOf(slot);
        if (index < 0)
            return;
        this._slots.splice(index, 1);
        if (slot === this._host) {
            // The dock is going: there is nothing left to tell it.
            if (this._announcedDash === slot.dash) {
                this._menuAnnounced = false;
                this._announcedDash = null;
            }
            this._restoreAll();
            this._host = null;
        }
        this._schedule();
    }

    _removeSlot(slot) {
        const index = this._slots.indexOf(slot);
        if (index < 0)
            return;
        this._slots.splice(index, 1);
        if (slot === this._host) {
            this._restoreAll();
            this._host = null;
        }
        for (const end of [slot.left, slot.right]) {
            if (isActorValid(end))
                end.destroy();
        }
    }

    // --- The buttons ---------------------------------------------------------------------------------------------

    // child-added comes from inside the panel's own code, which goes on with the button.
    _queueSync() {
        if (this._syncIdleId || !this._host)
            return;
        this._syncIdleId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._syncIdleId = 0;
            this._syncButtons();
            return GLib.SOURCE_REMOVE;
        });
    }

    // Takes every button the top bar has into the host dock and puts them in the set order.
    _syncButtons() {
        const host = this._host;
        if (!host || this._syncing)
            return;
        this._syncing = true;
        try {
            const entries = this._takeButtons(host);
            const order = this._order(entries);
            const apps = order.indexOf(APPS);
            // Unlisted tray icons sit next to the apps, on the right.
            const rank = entry => {
                const index = order.indexOf(entry.role);
                return index < 0 ? apps + 0.5 : index;
            };
            entries.sort((a, b) => rank(a) - rank(b));
            this._fill(host.left, entries.filter(entry => rank(entry) < apps));
            this._fill(host.right, entries.filter(entry => rank(entry) > apps));
            this._centerQuickSettings();
            this._syncClones();
        } finally {
            this._syncing = false;
        }
    }

    _takeButtons(host) {
        const dockTray = Main.extensionManager.lookup(DOCK_TRAY_UUID)?.state === ACTIVE;
        const entries = [];
        // Where each is in the top bar, read before any of them leaves it.
        const places = new Map();
        for (const box of this._panelBoxes)
            box.get_children().forEach((child, index) => places.set(child, index));
        for (const [role, indicator] of Object.entries(Main.panel.statusArea)) {
            const container = indicator?.container;
            if (!isActorValid(container))
                continue;
            const parent = container.get_parent();
            if (this._panelBoxes.includes(parent)) {
                if (dockTray && role.startsWith(TRAY_ROLE))
                    continue;
                const destroyId = this._origins.get(container)?.destroyId ??
                    container.connect('destroy', () => this._origins.delete(container));
                this._origins.set(container, {
                    parent,
                    index: places.get(container),
                    side: parent === this._panelBoxes[0] ? 'left' : 'right',
                    destroyId,
                });
                parent.remove_child(container);
                this._trackMenu(indicator);
            } else if (!this._origins.has(container)) {
                continue;
            } else if (parent && parent !== host.left && parent !== host.right) {
                // Another extension took it out of the dock: it is theirs now.
                this._forget(container, indicator);
                continue;
            }
            entries.push({role, container, side: this._origins.get(container).side});
        }
        return entries;
    }

    // The set order, with the buttons it does not list yet written into it next to the apps, on the side of the top
    // bar they come from, so the preferences can show and move them.
    _order(entries) {
        const saved = this._settings.get_strv('dock-bar-order');
        const order = saved.includes(APPS) ? [...saved] : [...saved, APPS];
        // In the top bar's order, each after the one before.
        const index = entry => this._origins.get(entry.container).index;
        let added = 0;
        for (const {role, side} of [...entries].sort((a, b) => index(a) - index(b))) {
            if (order.includes(role) || role.startsWith(TRAY_ROLE))
                continue;
            if (side === 'left')
                order.splice(order.indexOf(APPS), 0, role);
            else
                order.splice(order.indexOf(APPS) + 1 + added++, 0, role);
        }
        if (order.length !== saved.length)
            this._settings.set_strv('dock-bar-order', order);
        return order;
    }

    _fill(box, entries) {
        entries.forEach(({container}, i) => {
            const parent = container.get_parent();
            if (parent !== box) {
                parent?.remove_child(container);
                box.add_child(container);
            }
            box.set_child_at_index(container, i);
        });
    }

    // Quick settings opens from its button's left edge and counts on the screen edge to push it back. In the dock it
    // would hang past the dock's end, so there it opens centered on its button.
    _centerQuickSettings() {
        const indicator = Main.panel.statusArea.quickSettings;
        const menu = indicator?.menu;
        if (!menu || this._quickSettings || !this._inDock(indicator))
            return;
        this._quickSettings = {menu, alignment: menu._arrowAlignment};
        menu._arrowAlignment = 0.5;
    }

    _uncenterQuickSettings() {
        if (!this._quickSettings)
            return;
        const {menu, alignment} = this._quickSettings;
        this._quickSettings = null;
        if (alignment !== undefined)
            menu._arrowAlignment = alignment;
    }

    _forget(container, indicator) {
        const origin = this._origins.get(container);
        if (!origin)
            return;
        this._origins.delete(container);
        if (isActorValid(container))
            container.disconnect(origin.destroyId);
        if (indicator)
            this._untrackMenu(indicator);
    }

    // Puts every button back where it was in the top bar, in the top bar's order.
    _restoreAll() {
        this._endMenu();
        this._uncenterQuickSettings();
        const ours = new Set(this._slots.flatMap(slot => [slot.left, slot.right]));
        if (this._host)
            [this._host.left, this._host.right].forEach(end => ours.add(end));
        const origins = [...this._origins].sort(([, a], [, b]) => a.index - b.index);
        this._origins.clear();
        for (const [container, origin] of origins) {
            if (!isActorValid(container))
                continue;
            container.disconnect(origin.destroyId);
            const parent = container.get_parent();
            // Elsewhere, another extension has it.
            if (parent && !ours.has(parent))
                continue;
            parent?.remove_child(container);
            const home = isActorValid(origin.parent) ? origin.parent : Main.panel._rightBox;
            home.insert_child_at_index(container, Math.min(origin.index, home.get_n_children()));
        }
        for (const indicator of [...this._menus.keys()])
            this._untrackMenu(indicator);
        // The clones' buttons are gone from the dock.
        for (const slot of this._slots) {
            if (slot !== this._host)
                [slot.left, slot.right].forEach(end => isActorValid(end) && end.destroy_all_children());
        }
    }

    // --- Several docks -------------------------------------------------------------------------------------------

    // Every dock but the host shows a clone of each button, in the same order.
    _syncClones() {
        const host = this._host;
        if (!host)
            return;
        for (const slot of this._slots) {
            if (slot === host)
                continue;
            for (const side of ['left', 'right']) {
                slot[side].destroy_all_children();
                for (const container of host[side].get_children()) {
                    const button = container.child;
                    if (!button)
                        continue;
                    const clone = new Clutter.Clone({source: button, y_align: Clutter.ActorAlign.FILL});
                    // A hidden button leaves no gap in the other docks either.
                    const update = () => {
                        clone.visible = container.visible && button.visible;
                    };
                    container.connectObject('notify::visible', update, clone);
                    button.connectObject('notify::visible', update, clone);
                    update();
                    slot[side].add_child(clone);
                }
            }
        }
    }

    _queueMove() {
        if (this._moveLaterId)
            return;
        this._moveLaterId = global.compositor.get_laters().add(Meta.LaterType.BEFORE_REDRAW, () => {
            this._moveLaterId = 0;
            const hovered = this._slots.find(slot => slot.left.hover || slot.right.hover);
            if (hovered)
                this._moveTo(hovered);
            return false;
        });
    }

    _moveTo(slot) {
        const from = this._host;
        // A menu stays with its button: the buttons are not pulled from under an open one.
        if (!from || slot === from || !this._slots.includes(slot) || this._menuOpen())
            return;
        for (const side of ['left', 'right']) {
            slot[side].destroy_all_children();
            for (const container of from[side].get_children()) {
                from[side].remove_child(container);
                slot[side].add_child(container);
            }
        }
        this._host = slot;
        this._syncClones();
    }

    // --- Menus ---------------------------------------------------------------------------------------------------

    _inDock(indicator) {
        const host = this._host;
        const container = indicator?.container;
        return !!host && isActorValid(container) && (host.left.contains(container) || host.right.contains(container));
    }

    _menuOpen() {
        return [...this._menus].some(([indicator, {menu}]) => menu.isOpen && this._inDock(indicator));
    }

    _trackMenu(indicator) {
        const menu = indicator.menu;
        if (this._menus.has(indicator) || !(menu instanceof PopupMenu.PopupMenu))
            return;
        // The menu manager grabs the pointer as the menu opens, before any open-state-changed handler runs. The dock
        // then sees the pointer leave and starts hiding, which telling it about the menu afterwards does not stop. So
        // it is told before the menu opens, as Dash to Dock does for its app icons' menus.
        const ownOpen = Object.hasOwn(menu, 'open') ? menu.open : undefined;
        const open = menu.open;
        menu.open = (...args) => {
            if (!menu.isOpen && this._inDock(indicator))
                this._announceMenu();
            const result = open.apply(menu, args);
            if (!menu.isOpen)
                this._queueMenuClosed();
            return result;
        };
        const entry = {menu, ownOpen, lastY: null, id: 0};
        entry.id = menu.connect('open-state-changed', (_menu, isOpen) => {
            if (!this._inDock(indicator))
                return;
            entry.lastY = null;
            if (isOpen) {
                // The menus were added to uiGroup before the dock was: they go above it.
                Main.layoutManager.uiGroup.set_child_above_sibling(menu.actor, null);
                this._announceMenu();
            } else {
                this._queueMenuClosed();
            }
        });
        entry.destroyId = indicator.connect('destroy', () => this._menus.delete(indicator));
        this._menus.set(indicator, entry);
    }

    _untrackMenu(indicator) {
        const entry = this._menus.get(indicator);
        if (!entry)
            return;
        this._menus.delete(indicator);
        indicator.disconnect(entry.destroyId);
        entry.menu.disconnect(entry.id);
        if (entry.ownOpen)
            entry.menu.open = entry.ownOpen;
        else
            delete entry.menu.open;
    }

    // Keeps a dock that hides by itself shown while one of the menus is open.
    _announceMenu() {
        if (this._closeIdleId) {
            GLib.source_remove(this._closeIdleId);
            this._closeIdleId = 0;
        }
        const dash = this._host?.dash;
        if (this._menuAnnounced || !isActorValid(dash))
            return;
        this._menuAnnounced = true;
        this._announcedDash = dash;
        dash.emit('menu-opened');
    }

    // Lets the dock hide again once no menu is open. Going from one button to the next closes a menu and opens another,
    // and the dock must not start hiding in between: this waits for an idle.
    _queueMenuClosed() {
        if (this._closeIdleId || !this._menuAnnounced)
            return;
        this._closeIdleId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._closeIdleId = 0;
            if (!this._menuOpen()) {
                this._endMenu();
                // The pointer may have gone to another dock while the menu held it.
                this._queueMove();
            }
            return GLib.SOURCE_REMOVE;
        });
    }

    _endMenu() {
        if (this._closeIdleId) {
            GLib.source_remove(this._closeIdleId);
            this._closeIdleId = 0;
        }
        if (!this._menuAnnounced)
            return;
        this._menuAnnounced = false;
        if (isActorValid(this._announcedDash))
            this._announcedDash.emit('menu-closed');
        this._announcedDash = null;
    }

    // --- Per frame -----------------------------------------------------------------------------------------------

    _frame() {
        for (const {container, left, right} of this._slots) {
            if (!isActorValid(container))
                continue;
            // Dash to Dock and Dock Tray put theirs at the ends too.
            if (container.get_first_child() !== left)
                container.set_child_below_sibling(left, null);
            if (container.get_last_child() !== right)
                container.set_child_above_sibling(right, null);
        }
        if (!this._host)
            return;
        this._fitHighlight();
        // A menu opened by a shortcut while the dock was hidden was placed off its button, which then slides in.
        for (const [indicator, entry] of this._menus) {
            if (!entry.menu.isOpen || !this._inDock(indicator))
                continue;
            const [, y] = indicator.get_transformed_position();
            if (entry.lastY !== null && y !== entry.lastY)
                entry.menu._boxPointer?.setPosition(entry.menu.sourceActor, entry.menu._arrowAlignment);
            entry.lastY = y;
        }
    }

    // The buttons span the dock, so the pointer has them from the screen edge on, as it has the apps. Their highlight
    // is cut down to a pill in the middle by transparent borders, as the theme does it in the top bar. The borders are
    // as wide on all four sides: St takes each side's border off the corner radius, so uneven ones make the pill's ends
    // elliptical. The apps set the dock's thickness, whatever the buttons need.
    _fitHighlight() {
        const apps = this._host.container.get_children().find(child => child.get_name() === 'dashtodockDashScrollview');
        const thickness = apps?.get_preferred_height(-1)[1] ?? 0;
        if (!(thickness > 0))
            return;
        const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        const border = Math.max(MIN_BORDER, Math.round((thickness / scale - PILL) / 2));
        if (border === this._border)
            return;
        this._border = border;
        const borders = width => `    border: ${width}px solid transparent !important;\n`;
        // The clock's highlight is on its label.
        const clock = `.${BAR_CLASS} .panel-button.clock-display`;
        this._style.set(`.${BAR_CLASS} .panel-button {\n${borders(border)}}\n` +
            `${clock} {\n${borders(0)}}\n${clock} .clock {\n${borders(border)}}\n`);
    }

    destroy() {
        this._removeFrames();
        for (const disconnect of this._disconnects)
            disconnect();
        this._disconnects = [];
        for (const key of ['_idleId', '_timeoutId', '_syncIdleId']) {
            if (this[key])
                GLib.source_remove(this[key]);
            this[key] = 0;
        }
        if (this._moveLaterId)
            global.compositor.get_laters().remove(this._moveLaterId);
        this._moveLaterId = 0;
        for (const slot of [...this._slots])
            this._removeSlot(slot);
        this._restoreAll();
        setTopBarsHidden(false);
        this._style.destroy();
    }
}
