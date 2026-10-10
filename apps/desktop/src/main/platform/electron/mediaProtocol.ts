import { net, protocol, type CustomScheme } from 'electron'
import { pathToFileURL } from 'node:url'
import type { Context, Plugin } from '@deepseek-ai/cordis'
import { resolveLocalMediaPath } from '@eleckoi/dsh-product-data/media'
import { LOCAL_MEDIA_SCHEME } from '@shared/foundation/mediaReference'

export const localMediaScheme = {
  scheme: LOCAL_MEDIA_SCHEME,
  privileges: {
    standard: true,
    secure: true,
    supportFetchAPI: true,
    corsEnabled: true
  }
} satisfies CustomScheme

export const mediaProtocolPlugin = {
  name: 'eleckoi-media-protocol',
  inject: ['appPaths'],
  apply(ctx: Context) {
    protocol.handle(LOCAL_MEDIA_SCHEME, async (request) => {
      const path = resolveLocalMediaPath(ctx.appPaths.media, request.url)
      return path ? net.fetch(pathToFileURL(path).toString()) : new Response(null, { status: 404 })
    })
    return () => protocol.unhandle(LOCAL_MEDIA_SCHEME)
  }
} satisfies Plugin.Object
