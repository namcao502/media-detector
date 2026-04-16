// components/__tests__/ThemeButton.test.tsx
import { render, screen, fireEvent } from '@testing-library/react'
import ThemeButton from '../ThemeButton'

const mockSetPreset = jest.fn()
const mockToggleRainbow = jest.fn()

const defaultProps = {
  accentHex: '#e94560',
  isRainbow: false,
  setPreset: mockSetPreset,
  toggleRainbow: mockToggleRainbow,
}

beforeEach(() => {
  mockSetPreset.mockClear()
  mockToggleRainbow.mockClear()
})

describe('ThemeButton', () => {
  it('renders the theme toggle button', () => {
    render(<ThemeButton {...defaultProps} />)
    expect(screen.getByRole('button', { name: /theme/i })).toBeInTheDocument()
  })

  it('popup is not visible initially', () => {
    render(<ThemeButton {...defaultProps} />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('opens popup when theme button is clicked', () => {
    render(<ThemeButton {...defaultProps} />)
    fireEvent.click(screen.getByRole('button', { name: /theme/i }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('closes popup when clicking outside', () => {
    render(<ThemeButton {...defaultProps} />)
    fireEvent.click(screen.getByRole('button', { name: /theme/i }))
    fireEvent.mouseDown(document.body)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('calls setPreset when a preset swatch is clicked', () => {
    render(<ThemeButton {...defaultProps} />)
    fireEvent.click(screen.getByRole('button', { name: /theme/i }))
    fireEvent.click(screen.getByRole('button', { name: /color blue/i }))
    expect(mockSetPreset).toHaveBeenCalledWith('#3b82f6')
  })

  it('calls toggleRainbow when rainbow strip is clicked', () => {
    render(<ThemeButton {...defaultProps} />)
    fireEvent.click(screen.getByRole('button', { name: /theme/i }))
    fireEvent.click(screen.getByRole('button', { name: /rainbow/i }))
    expect(mockToggleRainbow).toHaveBeenCalled()
  })

  it('shows active outline on rainbow button when isRainbow is true', () => {
    render(<ThemeButton {...defaultProps} isRainbow />)
    fireEvent.click(screen.getByRole('button', { name: /theme/i }))
    const rainbowBtn = screen.getByRole('button', { name: /rainbow/i })
    expect(rainbowBtn.style.outline).not.toBe('none')
  })

  it('marks active preset swatch with data-active attribute', () => {
    render(<ThemeButton {...defaultProps} accentHex="#3b82f6" />)
    fireEvent.click(screen.getByRole('button', { name: /theme/i }))
    expect(screen.getByRole('button', { name: /color blue/i })).toHaveAttribute('data-active', 'true')
    expect(screen.getByRole('button', { name: /color custom/i })).not.toHaveAttribute('data-active', 'true')
  })

  it('marks custom swatch active when accent hex is not a preset', () => {
    render(<ThemeButton {...defaultProps} accentHex="#abcdef" />)
    fireEvent.click(screen.getByRole('button', { name: /theme/i }))
    expect(screen.getByRole('button', { name: /color custom/i })).toHaveAttribute('data-active', 'true')
  })

  it('custom picker onChange calls setPreset with the chosen hex', () => {
    render(<ThemeButton {...defaultProps} />)
    fireEvent.click(screen.getByRole('button', { name: /theme/i }))
    const colorInput = document.querySelector('input[type="color"]') as HTMLInputElement
    fireEvent.change(colorInput, { target: { value: '#ff6600' } })
    expect(mockSetPreset).toHaveBeenCalledWith('#ff6600')
  })
})

describe('ThemeButton integration', () => {
  it('renders theme button with correct aria-label for screen readers', () => {
    render(<ThemeButton {...defaultProps} />)
    const btn = screen.getByRole('button', { name: /theme/i })
    expect(btn).toBeInTheDocument()
    expect(btn).not.toBeDisabled()
  })
})
