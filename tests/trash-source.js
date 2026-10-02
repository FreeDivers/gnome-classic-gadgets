// SPDX-License-Identifier: MIT
// Test-only GTK4 Wayland drag source. Only offers files created by the isolated test.
import Gtk from 'gi://Gtk?version=4.0';
import Gdk from 'gi://Gdk?version=4.0';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {programArgs} from 'system';
Gtk.init();
const files = programArgs.map(path => Gio.File.new_for_path(path));
if (files.length !== 2 || files.some(file => !file.get_basename().startsWith('cg-trash-test-'))) throw new Error('Test files only');
const window = new Gtk.Window({title:'classic-gadgets-test-file-source',default_width:330,default_height:180});
const box = new Gtk.Box({orientation:Gtk.Orientation.VERTICAL,spacing:12,margin_top:25,margin_bottom:25,margin_start:25,margin_end:25});
box.append(new Gtk.Label({label:'拖动两个临时测试文件到回收站'}));
box.append(new Gtk.Label({label:files.map(file=>file.get_basename()).join('\n')}));
const source = new Gtk.DragSource({actions:Gdk.DragAction.COPY | Gdk.DragAction.MOVE});
source.connect('prepare',()=>Gdk.ContentProvider.new_for_value(Gdk.FileList.new_from_array(files)));
source.connect('drag-begin',()=>print('TEST drag-begin'));
source.connect('drag-end',()=>print('TEST drag-end'));
box.add_controller(source); window.set_child(box);
const loop=new GLib.MainLoop(null,false); window.connect('close-request',()=>{loop.quit();return false;});
window.present(); loop.run();
