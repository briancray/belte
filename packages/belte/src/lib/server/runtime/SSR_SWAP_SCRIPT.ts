/*
The tiny inline script the belte-ui SSR stream ships in <head>. For each streamed
`<belte-resolve data-id data-resume>` frame it registers the resolved value into
`window.__belteResume` (the resume manifest hydration reads) and swaps the resolved
markup into the matching `<!--belte:await:ID-->…<!--/belte:await:ID-->` boundary —
so the pending shell paints instantly and each value lands as it arrives, before
the client bundle even loads. Vanilla and self-contained (no framework runtime),
minified to one line so it inlines cheaply ahead of the document body.
*/
export const SSR_SWAP_SCRIPT =
    "function __belteSwap(){var f=document.querySelector('belte-resolve');while(f){" +
    "var id=f.getAttribute('data-id'),w=document.createTreeWalker(document.body,NodeFilter.SHOW_COMMENT),o=null,c;" +
    "try{(window.__belteResume=window.__belteResume||{})[id]=JSON.parse(f.getAttribute('data-resume')||'null');}catch(e){}" +
    "while((c=w.nextNode())){if(c.data==='belte:await:'+id){o=c;break;}}" +
    "if(o){var n=o.nextSibling;while(n&&!(n.nodeType===8&&n.data==='/belte:await:'+id)){var x=n.nextSibling;n.remove();n=x;}" +
    "while(f.firstChild){o.parentNode.insertBefore(f.firstChild,n);}}f.remove();f=document.querySelector('belte-resolve');}}"
