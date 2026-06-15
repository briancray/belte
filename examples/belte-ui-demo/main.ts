import { startClient } from 'belte/ui/startClient'
import About from './About.belte'
import Data from './Data.belte'
import Form from './Form.belte'
import Home from './Home.belte'

/* Client entry: belte-ui's startClient seeds the tab cache store from the server's
   __SSR__ snapshot, installs the mount base, and starts the router — which adopts
   the server-rendered #app for the initial route, then drives SPA navigation. No
   clearing, no re-render on load; even `/data` resumes from the stream's value. */
startClient({ '/': Home, '/about': About, '/form': Form, '/data': Data })
