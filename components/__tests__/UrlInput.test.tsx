import { render, screen, fireEvent } from '@testing-library/react'
import UrlInput from '../UrlInput'

describe('UrlInput', () => {
  it('renders the URL input and Detect button', () => {
    render(<UrlInput onDetect={jest.fn()} disabled={false} loading={false} />)
    expect(screen.getByPlaceholderText(/youtube/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /detect/i })).toBeInTheDocument()
  })

  it('calls onDetect with the trimmed URL when form is submitted', () => {
    const onDetect = jest.fn()
    render(<UrlInput onDetect={onDetect} disabled={false} loading={false} />)
    fireEvent.change(screen.getByPlaceholderText(/youtube/i), {
      target: { value: '  https://youtube.com/watch?v=x  ' },
    })
    fireEvent.click(screen.getByRole('button', { name: /detect/i }))
    expect(onDetect).toHaveBeenCalledWith('https://youtube.com/watch?v=x')
  })

  it('disables the button when disabled prop is true', () => {
    render(<UrlInput onDetect={jest.fn()} disabled={true} loading={false} />)
    expect(screen.getByRole('button', { name: /detect/i })).toBeDisabled()
  })

  it('shows loading state when loading prop is true', () => {
    render(<UrlInput onDetect={jest.fn()} disabled={false} loading={true} />)
    expect(screen.getByRole('button')).toHaveTextContent(/detecting/i)
  })
})
