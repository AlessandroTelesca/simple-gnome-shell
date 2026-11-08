import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';

/**
 * A stylesheet generated from the settings. St has no variables, and it takes a stylesheet to reach actors built later,
 * by this extension or others.
 */
export class GeneratedStylesheet {
    constructor(name) {
        const dir = GLib.build_filenamev([GLib.get_user_cache_dir(), 'simple-gnome-shell']);
        GLib.mkdir_with_parents(dir, 0o755);
        this._file = Gio.File.new_for_path(GLib.build_filenamev([dir, name]));
        this._context = St.ThemeContext.get_for_stage(global.stage);
        this._theme = null;
        this._css = null;
        // A new shell theme comes without this stylesheet.
        this._contextId = this._context.connect('changed', () => {
            if (this._theme && this._context.get_theme() !== this._theme)
                this.set(this._css);
        });
    }

    /** Loads `css` in place of what was loaded; null just unloads it. */
    set(css) {
        this._unload();
        this._css = css;
        if (css === null)
            return;
        this._file.replace_contents(css, null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null);
        this._theme = this._context.get_theme();
        this._theme?.load_stylesheet(this._file);
    }

    _unload() {
        this._theme?.unload_stylesheet(this._file);
        this._theme = null;
    }

    destroy() {
        this._context.disconnect(this._contextId);
        this._unload();
    }
}
