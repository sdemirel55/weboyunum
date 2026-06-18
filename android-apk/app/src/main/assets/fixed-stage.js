(function () {
  "use strict";

  var DESIGN_W = 1297;
  var DESIGN_H = 721;
  var root = document.documentElement;
  var timer = 0;
  var applying = false;

  function removeClass(el, name) {
    if (!el) return;
    if (el.classList) el.classList.remove(name);
  }

  function addClass(el, name) {
    if (!el) return;
    if (el.classList) el.classList.add(name);
  }

  function hasClass(el, name) {
    return !!(el && el.classList && el.classList.contains(name));
  }

  function installStyle() {
    if (document.getElementById("sfdApkFixedStyle")) return;
    var style = document.createElement("style");
    style.id = "sfdApkFixedStyle";
    style.textContent = [
      "html.sfd-apk-fixed{",
      "--sfd-vw:1297px!important;",
      "--sfd-vh:721px!important;",
      "--sfd-stage-w:1297px!important;",
      "--sfd-stage-h:721px!important;",
      "--sfd-usable-w:1297px!important;",
      "--sfd-usable-h:721px!important;",
      "--sfd-safe-left:0px!important;",
      "--sfd-safe-right:0px!important;",
      "--sfd-safe-top:0px!important;",
      "--sfd-safe-bottom:0px!important;",
      "background:#020307!important;",
      "}",
      "html.sfd-apk-fixed,html.sfd-apk-fixed body{",
      "width:100%!important;height:100%!important;min-width:0!important;min-height:0!important;",
      "margin:0!important;padding:0!important;overflow:hidden!important;background:#020307!important;",
      "-webkit-text-size-adjust:100%!important;text-size-adjust:100%!important;",
      "}",
      "html.sfd-apk-fixed body{position:fixed!important;inset:0!important;}",
      "html.sfd-apk-fixed #mobileOrientationNotice,",
      "html.sfd-apk-fixed #sfdOrientationOverlayV136,",
      "html.sfd-apk-fixed #sfdMobilePortraitV126{display:none!important;}",
      "html.sfd-apk-fixed #gameScreen.neon-game:not(.hidden){",
      "position:fixed!important;left:0!important;top:0!important;right:auto!important;bottom:auto!important;",
      "width:1297px!important;height:721px!important;min-width:1297px!important;min-height:721px!important;",
      "max-width:none!important;max-height:none!important;margin:0!important;padding:0!important;",
      "transform:translate3d(var(--sfd-apk-x),var(--sfd-apk-y),0) scale(var(--sfd-apk-scale))!important;",
      "transform-origin:0 0!important;overflow:hidden!important;zoom:1!important;",
      "}",
      "html.sfd-apk-fixed #gameScreen.neon-game:not(.hidden) .neon-top,",
      "html.sfd-apk-fixed #gameScreen.neon-game:not(.hidden) .neon-main{max-width:none!important;}",
      "html.sfd-apk-fixed #gameScreen #drawCanvas{touch-action:none!important;}",
      "html.sfd-apk-fixed body.sfd-apk-drawing #gameScreen #viewerStatus{display:none!important;}",
      "html.sfd-apk-fixed body.sfd-apk-drawing #gameScreen #drawToolsBar.neon-toolbar:not(.hidden){display:block!important;}",
      "html.sfd-apk-fixed body:not(.sfd-apk-drawing) #gameScreen #drawToolsBar.neon-toolbar{display:none!important;}",
      "html.sfd-apk-fixed body:not(.sfd-apk-drawing) #gameScreen #viewerStatus:not(.hidden){display:block!important;}",
      "html.sfd-apk-fixed #gameScreen #viewerStatus.hidden,",
      "html.sfd-apk-fixed #gameScreen #drawToolsBar.hidden{display:none!important;}",
      "html.sfd-apk-fixed #gameScreen #hintBtn.hidden,",
      "html.sfd-apk-fixed #gameScreen #skipBtn.hidden{display:none!important;}",
      "html.sfd-apk-fixed #gameScreen .neon-word-card.drawer-secret-word .hex-letter{font-size:24px!important;line-height:1!important;}",
      "html.sfd-apk-fixed #gameScreen .neon-word-card.drawer-secret-word .hex-cell{min-width:32px!important;width:32px!important;min-height:38px!important;height:38px!important;}",
      "html.sfd-apk-fixed #gameScreen #skipBtn:before,html.sfd-apk-fixed #gameScreen #skipBtn:after{content:none!important;display:none!important;}",
      "html.sfd-apk-fixed #gameScreen #skipBtn{background:url('/neon-assets/button-skip-v101.png?v=101') center/contain no-repeat!important;}",
      "html.sfd-apk-fixed #gameScreen #hintBtn{background:url('/neon-assets/button-hint.png') center/contain no-repeat!important;}",
      "html.sfd-apk-fixed #gameScreen #skipBtn *,html.sfd-apk-fixed #gameScreen #hintBtn *{opacity:0!important;visibility:hidden!important;}",
      "#sfdApkBackdrop{position:fixed;inset:0;z-index:999;background:#020307;pointer-events:none;}",
      "html.sfd-apk-fixed #gameScreen.neon-game:not(.hidden)~#sfdApkBackdrop{display:none;}",
    ].join("");
    document.head.appendChild(style);
  }

  function cleanLegacyClasses() {
    var body = document.body;
    var rootClasses = [
      "sfd-android-v137", "sfd-android-v138", "sfd-android-v139", "sfd-android-v140", "sfd-android-v141",
      "sfd-v136-compact-height", "sfd-v136-narrow-width", "sfd-v136-keyboard"
    ];
    var bodyClasses = [
      "sfd-v137-game-active", "sfd-v138-game-active", "sfd-v139-game-active", "sfd-v140-game-active", "sfd-v141-game-active",
      "sfd-v137-drawing", "sfd-v138-drawing", "sfd-v139-drawing", "sfd-v140-drawing", "sfd-v141-drawing"
    ];
    for (var i = 0; i < rootClasses.length; i += 1) removeClass(root, rootClasses[i]);
    for (var j = 0; j < bodyClasses.length; j += 1) removeClass(body, bodyClasses[j]);
    addClass(root, "sfd-mobile-v136");
    addClass(root, "sfd-apk-fixed");
  }

  function syncDrawingState() {
    var body = document.body;
    var game = document.getElementById("gameScreen");
    var tools = document.getElementById("drawToolsBar");
    var viewer = document.getElementById("viewerStatus");
    var active = !!(game && !hasClass(game, "hidden"));
    var drawing = false;

    if (active) {
      if (hasClass(body, "drawer-mode")) drawing = true;
      else if (hasClass(body, "viewer-mode")) drawing = false;
      else if (tools && !hasClass(tools, "hidden")) drawing = true;
      else if (viewer && hasClass(viewer, "hidden")) drawing = true;
    }

    if (drawing) addClass(body, "sfd-apk-drawing");
    else removeClass(body, "sfd-apk-drawing");

    if (tools && tools.style) tools.style.removeProperty("display");
    if (viewer && viewer.style) viewer.style.removeProperty("display");
  }

  function applyScale() {
    if (applying) return;
    applying = true;
    cleanLegacyClasses();
    installStyle();

    var viewport = window.visualViewport;
    var vw = Math.max(1, Math.round(viewport ? viewport.width : (window.innerWidth || document.documentElement.clientWidth || DESIGN_W)));
    var vh = Math.max(1, Math.round(viewport ? viewport.height : (window.innerHeight || document.documentElement.clientHeight || DESIGN_H)));
    var scale = Math.min(vw / DESIGN_W, vh / DESIGN_H);
    var x = Math.max(0, Math.round((vw - DESIGN_W * scale) / 2));
    var y = Math.max(0, Math.round((vh - DESIGN_H * scale) / 2));

    root.style.setProperty("--sfd-apk-scale", String(scale), "important");
    root.style.setProperty("--sfd-apk-x", x + "px", "important");
    root.style.setProperty("--sfd-apk-y", y + "px", "important");
    root.style.setProperty("--sfd-vw", DESIGN_W + "px", "important");
    root.style.setProperty("--sfd-vh", DESIGN_H + "px", "important");
    root.style.setProperty("--sfd-stage-w", DESIGN_W + "px", "important");
    root.style.setProperty("--sfd-stage-h", DESIGN_H + "px", "important");

    syncDrawingState();
    applying = false;
  }

  function schedule() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(function () {
      timer = 0;
      applyScale();
    }, 35);
  }

  function watch(el) {
    if (!el || el.getAttribute("data-sfd-apk-observed") === "1" || typeof MutationObserver === "undefined") return;
    el.setAttribute("data-sfd-apk-observed", "1");
    new MutationObserver(schedule).observe(el, { attributes: true, attributeFilter: ["class", "style"] });
  }

  function observe() {
    watch(document.body);
    watch(document.getElementById("gameScreen"));
    watch(document.getElementById("drawToolsBar"));
    watch(document.getElementById("viewerStatus"));
  }

  function init() {
    installStyle();
    cleanLegacyClasses();
    applyScale();
    observe();
    window.addEventListener("resize", schedule, false);
    window.addEventListener("orientationchange", function () {
      schedule();
      setTimeout(schedule, 150);
      setTimeout(schedule, 500);
    }, false);
    if (window.visualViewport) {
      window.visualViewport.addEventListener("resize", schedule, false);
      window.visualViewport.addEventListener("scroll", schedule, false);
    }
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden) schedule();
    }, false);
    setInterval(function () {
      observe();
      applyScale();
    }, 500);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, false);
  else init();
})();
