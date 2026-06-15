import { router } from 'belte/ui/router'
import About from './About.belte'
import Data from './Data.belte'
import Form from './Form.belte'
import Home from './Home.belte'

/* Client entry: the router adopts the server-rendered #app in place (hydration)
   for the initial route, then drives SPA navigation — no clearing, no re-render
   on load. (The `/data` route uses `await`, which isn't adoptable yet, so the
   router mounts it fresh.) */
const app = document.getElementById('app')
if (app !== null) {
    router(app, { '/': Home, '/about': About, '/form': Form, '/data': Data })
}
