// users # settings

import E621Type from "@/interfaces/E621";
declare const E621: E621Type;

import { initCustomCSSEditor } from "@/components/custom_css_editor";
import "@/components/tabs";

$(() => {
  initCustomCSSEditor();
});

E621.Registry.register("v_users_settings");
