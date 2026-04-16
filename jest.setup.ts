import '@testing-library/jest-dom'

// Polyfill TextDecoder/TextEncoder for jsdom environment
import { TextDecoder, TextEncoder } from 'util'
global.TextDecoder = TextDecoder as unknown as typeof global.TextDecoder
global.TextEncoder = TextEncoder as unknown as typeof global.TextEncoder

// Mock fetch globally for jsdom tests - return a minimal response to avoid unhandled rejections
global.fetch = jest.fn(() =>
  Promise.resolve({
    ok: true,
    status: 200,
    body: null,
    json: () => Promise.resolve({}),
    text: () => Promise.resolve(''),
  } as unknown as Response)
)
