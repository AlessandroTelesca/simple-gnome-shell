import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

function hex(rgba) {
    const byte = v => Math.round(v * 255).toString(16).padStart(2, '0');
    return `#${byte(rgba.red)}${byte(rgba.green)}${byte(rgba.blue)}`;
}

export default class SimpleShellPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        // Kept alive with the window.
        window._simpleShellSettings = settings;
        const page = new Adw.PreferencesPage();
        window.add(page);

        const group = (title) => {
            const g = new Adw.PreferencesGroup({title});
            page.add(g);
            return g;
        };
        const toggle = (g, key, title, subtitle) => {
            const row = new Adw.SwitchRow({title, subtitle: subtitle ?? ''});
            settings.bind(key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
            g.add(row);
            return row;
        };
        const number = (g, key, title, lower, upper, step, digits = 0) => {
            const value = digits ? settings.get_double(key) : settings.get_int(key);
            const row = new Adw.SpinRow({
                title,
                digits,
                adjustment: new Gtk.Adjustment({lower, upper, step_increment: step, value}),
            });
            settings.bind(key, row, 'value', Gio.SettingsBindFlags.DEFAULT);
            g.add(row);
            return row;
        };

        const look = group(_('Look'));
        const colorRow = new Adw.ActionRow({title: _('Color')});
        const rgba = new Gdk.RGBA();
        rgba.parse(settings.get_string('color'));
        const colorButton = new Gtk.ColorDialogButton({
            dialog: new Gtk.ColorDialog({with_alpha: false}),
            rgba,
            valign: Gtk.Align.CENTER,
        });
        colorButton.connect('notify::rgba', () => {
            const value = hex(colorButton.rgba);
            if (value !== settings.get_string('color'))
                settings.set_string('color', value);
        });
        colorRow.add_suffix(colorButton);
        colorRow.activatable_widget = colorButton;
        look.add(colorRow);
        number(look, 'opacity', _('Opacity'), 0, 1, 0.05, 2);

        const bar = group(_('Top bar'));
        toggle(bar, 'top-bar-enabled', _('Grow out of the screen edge'));
        const styles = ['center', 'pill'];
        const style = new Adw.ComboRow({
            title: _('Style'),
            model: Gtk.StringList.new([_('Centered, shrunk to its buttons'), _('Across the monitor')]),
            selected: Math.max(styles.indexOf(settings.get_string('top-bar-style')), 0),
        });
        style.connect('notify::selected', () => settings.set_string('top-bar-style', styles[style.selected]));
        bar.add(style);
        const margin = number(bar, 'top-bar-margin', _('Side margin'), 0, 200, 1);
        const syncMargin = () => {
            margin.sensitive = settings.get_string('top-bar-style') === 'pill';
        };
        settings.connect('changed::top-bar-style', syncMargin);
        syncMargin();
        number(bar, 'top-bar-padding', _('Room beside the buttons'), 0, 64, 1);
        number(bar, 'top-bar-radius', _('Corner radius'), 0, 64, 1, 1);
        number(bar, 'top-bar-flare', _('Edge flare radius'), 0, 64, 1, 1);

        const dock = group(_('Dash to Dock'));
        toggle(dock, 'dock-enabled', _('Grow out of the screen edge'));
        number(dock, 'dock-radius', _('Corner radius'), 0, 64, 1, 1);
        number(dock, 'dock-flare', _('Edge flare radius'), 0, 64, 1, 1);

        const grow = group(_('Grown out of the bars'));
        toggle(grow, 'menus-grow', _('Top bar menus'));
        toggle(grow, 'dock-menus-grow', _('Dock menus'), _('On docks along the top or bottom of the screen'));
        toggle(grow, 'notifications-grow', _('Notifications'), _('Out of the screen edge while the bar is hidden'));
        toggle(grow, 'osd-grow', _('Volume and brightness popup'), _('Out of the screen edge while the bar is hidden'));
        toggle(grow, 'hidden-clock', _('Hidden clock tab'), _('Hide Top Bar: Multi Monitors\' clock, in this color'));
        number(grow, 'surface-radius', _('Corner radius'), 0, 64, 1, 1);
    }
}
