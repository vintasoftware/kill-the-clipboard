import { JSX } from 'typedoc'

export function load(app) {
  app.renderer.hooks.on('head.end', ctx => {
    return JSX.createElement('meta', {
      name: 'google-site-verification',
      content: '7RLd-JeO9IBqhFWkl5BnKUWcbki5S33mu4VZA-_N0nw',
    })
  })
}
