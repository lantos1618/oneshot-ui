/* Page CSS (an example, not part of the stable API; moved out of core in 0.4). UIProvider themes the page itself
   (target="html"), so you only need this for a page that renders outside UIProvider. */

/** Page background and text colour from the theme tokens, on `html`: `<style>{PAGE_CSS}</style>`. */
export const PAGE_CSS = 'html,html body{background:var(--bg);color:var(--fg)}'
