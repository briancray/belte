import Counter from './Counter.belte'

/* Client entry: take over the server-rendered shell and mount for interactivity.
   (No DOM-adoption yet, so clear the SSR markup and mount fresh — the rendered
   output is identical, so there's no visible change, just live event handlers.) */
const app = document.getElementById('app')
if (app !== null) {
    app.innerHTML = ''
    Counter(app)
}
