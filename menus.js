import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {bottomDockThickness} from './dock.js';
import {isActorValid} from './frames.js';
import {BarGrowth, animationsEnabled, barFrom} from './growth.js';
import {cappedHeight} from './layout.js';

const TRANSPARENT = 'simple-gnome-shell-transparent';
// The BoxPointer's own open and close eases, which are held while the bar grows and shrinks.
const BOXPOINTER_EASED = ['opacity', 'translation-x', 'translation-y', 'scale-x', 'scale-y'];
const BOXPOINTER_HOLD_MS = 10000;
// The shell's class for the notification center, which Multi Monitors Bar's copies of it share.
const DATE_MENU = 'datemenu-popover';
// The least room left between the notification center and a dock (px).
const DOCK_GAP = 16;

function buttonRect(source) {
    if (!isActorValid(source) || !source.mapped)
        return null;
    // The date menu grows from its clock rather than from the whole button.
    const label = source._clockDisplay;
    const actor = label instanceof St.Widget && label.mapped ? label : source;
    const [x, y] = actor.get_transformed_position();
    const [w, h] = actor.get_transformed_size();
    if (!Number.isFinite(x) || !Number.isFinite(y) || !(w >= 1) || !(h >= 1))
        return null;
    return [x, y, w, h];
}

/** One popup menu, which grows out of the bar its button is on and otherwise keeps the theme's look. */
class MenuGrowth {
    constructor(settings, frames, menu) {
        this._menu = menu;
        this._settings = settings;
        this._openedFrom = null;
        this._limit = null;
        const actor = menu.actor, box = menu.box;
        this._growth = new BarGrowth({
            key: 'menus',
            content: () => box,
            shown: () => actor.mapped,
            scale: () => actor.get_scale()[1] || 1,
            source: () => this._source(),
            button: () => buttonRect(this._openedFrom ?? menu.sourceActor),
            radius: () => settings.get_double('surface-radius'),
            limit: () => this._limit,
            // The menu stays where it opens, and stays visible until the shape is back in the bar.
            hold: opening => {
                if (opening) {
                    this._capHeight();
                    this._fitToBar();
                }
                for (const name of BOXPOINTER_EASED) {
                    const ease = actor.get_transition(name);
                    if (!ease)
                        continue;
                    if (opening) {
                        ease.set_from(ease.get_interval().peek_final_value());
                    } else {
                        ease.set_to(ease.get_interval().peek_initial_value());
                        if (name === 'opacity')
                            ease.set_duration(BOXPOINTER_HOLD_MS);
                    }
                }
            },
            closed: () => {
                this._setDrawn(false);
                if (!menu.isOpen)
                    actor.hide();
            },
        });
        this._openId = menu.connect('open-state-changed', (_menu, open) => this._onOpenState(open));
        this._mapId = actor.connect('notify::mapped', () => {
            if (!actor.mapped) {
                this._growth.release();
                this._setDrawn(false);
                this._uncap();
            }
        });
        this._removeFrames = frames.add(() => this._sync());
    }

    _source() {
        return (isActorValid(this._openedFrom) && this._openedFrom.mapped
            ? this._openedFrom : this._menu.sourceActor) ?? null;
    }

    // Limits the notification center to the set height, and to the room above a dock, shown or hidden. The shell only
    // keeps it on the work area, which a dock that hides by itself is not taken out of. Its lists scroll in what is left.
    _capHeight() {
        const box = this._menu.box;
        const source = this._source();
        if (!source || !box.has_style_class_name(DATE_MENU))
            return;
        const index = Main.layoutManager.findIndexForActor(source);
        const monitor = Main.layoutManager.monitors[index];
        box.get_allocation_box();
        const [, y] = box.get_transformed_position();
        if (!monitor || !Number.isFinite(y))
            return;
        // Where it rests, whatever the open animation has it at now.
        const top = y - box.translation_y - this._menu.actor.translation_y;
        const dockTop = monitor.y + monitor.height - bottomDockThickness(index);
        this._limit = dockTop - DOCK_GAP;
        const height = cappedHeight(this._settings.get_int('notification-center-max-height'), top, dockTop, DOCK_GAP);
        // max-height leaves out the padding and is in the theme's units.
        const node = box.get_theme_node();
        const extra = node.get_vertical_padding() + node.get_border_width(St.Side.TOP) + node.get_border_width(St.Side.BOTTOM);
        const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        const style = `max-height: ${Math.round(Math.max(height - extra, 0) / scale)}px;`;
        if (box.get_style() !== style)
            box.set_style(style);
        this._capped = true;
    }

    _uncap() {
        if (!this._capped)
            return;
        this._capped = false;
        this._limit = null;
        if (isActorValid(this._menu.box))
            this._menu.box.set_style(null);
    }

    // Whether the bar draws the menu's background, rather than the theme.
    _setDrawn(drawn) {
        for (const actor of [this._menu.actor, this._menu.box]) {
            if (!isActorValid(actor))
                continue;
            if (drawn)
                actor.add_style_class_name(TRANSPARENT);
            else
                actor.remove_style_class_name(TRANSPARENT);
        }
        if (!drawn)
            this._unfit();
    }

    // Widens the menu to the bar it should line up with, if any, and moves it over the bar: the shell centers it on the
    // button, which a dock fixed to a side puts off the bar's center. A menu wider than the bar stays that wide.
    _fitToBar() {
        const box = this._menu.box;
        const span = barFrom(this._source(), 'menus')?.menuSpan(this._menu);
        if (!span) {
            this._unfit();
            return;
        }
        const [x, width] = span;
        this._fitted = true;
        if (!box.min_width_set || box.min_width !== width)
            box.min_width = width;
        // The allocation first: it lays out the width set above, which the position then reflects.
        const boxWidth = box.get_allocation_box().get_width();
        const [boxX] = box.get_transformed_position();
        box.translation_x = x + Math.floor((width - boxWidth) / 2) - (boxX - box.translation_x);
    }

    _unfit() {
        if (!this._fitted)
            return;
        this._fitted = false;
        const box = this._menu.box;
        if (isActorValid(box)) {
            box.min_width_set = false;
            box.translation_x = 0;
        }
    }

    _onOpenState(open) {
        if (open)
            this._openedFrom = this._menu.sourceActor;
        // Without animations it is just there, in the bar's shape, which _sync() then holds.
        if (!animationsEnabled()) {
            if (!open) {
                this._growth.release();
                this._setDrawn(false);
            }
            return;
        }
        const grows = this._growth.start(open);
        if (open)
            this._setDrawn(grows);
    }

    // At rest, the bar follows the menu as it resizes, and lets it go when the bar goes.
    _sync() {
        if (!this._menu.isOpen || !this._menu.actor.mapped || this._growth.animating)
            return;
        this._capHeight();
        this._fitToBar();
        this._setDrawn(this._growth.holdAtRest());
    }

    destroy() {
        this._removeFrames();
        this._growth.release();
        this._setDrawn(false);
        this._uncap();
        this._menu.disconnect(this._openId);
        if (isActorValid(this._menu.actor))
            this._menu.actor.disconnect(this._mapId);
    }
}

/**
 * Hooks every popup menu in uiGroup: those of the top bars, Dock Tray's and Dash to Dock's. Which of them grow is
 * decided as each one opens, by whether its button is on a bar.
 */
export class Menus {
    constructor(settings, frames) {
        this._settings = settings;
        this._frames = frames;
        this._menus = new Map();
        const uiGroup = Main.layoutManager.uiGroup;
        this._addedId = uiGroup.connect('child-added', (_group, actor) => this._attach(actor));
        for (const child of uiGroup.get_children())
            this._attach(child);
    }

    _attach(actor) {
        const menu = actor._delegate;
        if (!(menu instanceof PopupMenu.PopupMenu) || menu.actor !== actor || this._menus.has(menu) || !menu.box)
            return;
        const growth = new MenuGrowth(this._settings, this._frames, menu);
        const destroyId = actor.connect('destroy', () => {
            this._menus.delete(menu);
            growth.destroy();
        });
        this._menus.set(menu, {growth, actor, destroyId});
    }

    destroy() {
        Main.layoutManager.uiGroup.disconnect(this._addedId);
        for (const {growth, actor, destroyId} of this._menus.values()) {
            actor.disconnect(destroyId);
            growth.destroy();
        }
        this._menus.clear();
    }
}
