import '@testing-library/jest-dom'

// Polyfill TextDecoder/TextEncoder for jsdom environment
import { TextDecoder, TextEncoder } from 'util'
global.TextDecoder = TextDecoder as unknown as typeof global.TextDecoder
global.TextEncoder = TextEncoder as unknown as typeof global.TextEncoder
