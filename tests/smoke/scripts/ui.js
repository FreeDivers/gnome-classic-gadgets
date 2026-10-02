// SPDX-License-Identifier: MIT
export async function run(app, h) {
    const center = actor => { const [x,y] = actor.get_transformed_position(), [w,ht] = actor.get_transformed_size(); return [x+w/2,y+ht/2]; };
    let prefs = 0; const original = app.openPreferences; app.openPreferences = () => prefs++;
    const puzzle = app.widgets.get('puzzle');
    await h.motion(...center(puzzle.actor)); await h.click(...center(puzzle.tools.options)); await h.wait(200);
    await app.dialog.whenReady();
    h.check(app.dialog?.isOpen && prefs === 0, 'gear opens only per-gadget options');
    h.check(app.dialog.rows.get('image').spec.values.length === 11, 'all 11 original puzzle pictures selectable');
    app.dialog.set('image',11); await h.wait(200);
    h.check(app.dialog.values.image === 11, 'native image picker draft reaches image 11');
    await h.screenshot('puzzle-options.png');
    const frame=app.dialog.nativeWindow.get_frame_rect(); await h.click(frame.x+frame.width-65,frame.y+frame.height-32); await h.wait(300);
    h.check(puzzle.options.image === 11 && puzzle.preview.originalAsset.endsWith('/11.png'), 'image selection saved and rendered');
    app.openOptions(puzzle); await app.dialog.whenReady(); app.dialog.set('image', 3); app.dialog.close();
    h.check(puzzle.options.image === 11, 'cancel does not persist draft');
    const system = app.widgets.get('system'); app.openOptions(system); await app.dialog.whenReady(); app.dialog.set('size','large'); app.dialog.set('scale',1.2); app.dialog.apply(); await h.wait(180);
    h.check(system.width === 198 && system.height === 159 && system.face.originalAsset.endsWith('back_lrg.png'), 'native large CPU layout');
    h.check(Math.abs(system.actor.scale_x - 1.2) < .01, 'per-gadget scale applied');
    app.showGallery(); const gallery=app.ui.gallery; await gallery.whenReady(); await h.wait(250);
    h.check(gallery.visible && gallery.nativeWindow && gallery.view.types.length===12,'gallery entry opens the native GTK4 catalogue');
    await h.screenshot('gallery.png');
    gallery.hide(); await h.click(600,850,3); await h.wait(100);
    h.check(app.ui.menus.menu?.isOpen, 'desktop background right-click opens menu'); app.ui.menus.close();
    await h.click(...center(puzzle.body),3); h.check(app.ui.menus.menu?.isOpen, 'gadget context menu opens'); app.ui.menus.close();
    app.setTheme('fluent'); await h.wait(200);
    h.check(puzzle.preview.assetPath.includes('/assets/fluent/') || puzzle.host.theme.name === 'fluent', 'theme switch reaches widgets');
    await h.screenshot('fluent-desktop.png'); app.openPreferences = original;
}
