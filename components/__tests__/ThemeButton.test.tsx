// components/__tests__/ThemeButton.test.tsx
import { render, screen, fireEvent } from '@testing-library/react'
import ThemeButton from '../ThemeButton'

const mockToggle = jest.fn()

beforeEach(() => {
  mockToggle.mockClear()
})

describe('ThemeButton', () => {
  it('offers to switch to dark mode while in light mode', () => {
    render(<ThemeButton mode="light" toggle={mockToggle} />)
    expect(screen.getByRole('button', { name: /switch to dark mode/i })).toBeInTheDocument()
  })

  it('offers to switch to light mode while in dark mode', () => {
    render(<ThemeButton mode="dark" toggle={mockToggle} />)
    expect(screen.getByRole('button', { name: /switch to light mode/i })).toBeInTheDocument()
  })

  it('calls toggle when clicked', () => {
    render(<ThemeButton mode="light" toggle={mockToggle} />)
    fireEvent.click(screen.getByRole('button'))
    expect(mockToggle).toHaveBeenCalledTimes(1)
  })
})
