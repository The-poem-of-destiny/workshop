import iframeSrcdoc from './iframe_srcdoc.html';

export function teleportStyle(appendTo: JQuery.Selector | JQuery.htmlString | JQuery.TypeOrArray<Element | DocumentFragment> | JQuery = 'head') {
  const $div = $('<div>')
    .attr('script_id', getScriptId())
    .append($('head > style', document).clone())
    .appendTo(appendTo);

  return {
    destroy: () => $div.remove(),
  };
}

export function createScriptIdIframe(): JQuery<HTMLIFrameElement> {
  return $('<iframe>').attr({
    script_id: getScriptId(),
    frameborder: 0,
    srcdoc: iframeSrcdoc,
  }) as JQuery<HTMLIFrameElement>;
}
