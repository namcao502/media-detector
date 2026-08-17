import { render, screen, fireEvent } from '@testing-library/react'
import UrlInput from '../UrlInput'

describe('UrlInput', () => {
  it('renders the URL input and Detect button', () => {
    render(<UrlInput onDetect={jest.fn()} disabled={false} loading={false} />)
    expect(screen.getByPlaceholderText(/youtube/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^detect$/i })).toBeInTheDocument()
  })

  it('calls onDetect with the trimmed URL when form is submitted', () => {
    const onDetect = jest.fn()
    render(<UrlInput onDetect={onDetect} disabled={false} loading={false} />)
    fireEvent.change(screen.getByPlaceholderText(/youtube/i), {
      target: { value: '  https://youtube.com/watch?v=x  ' },
    })
    fireEvent.click(screen.getByRole('button', { name: /^detect$/i }))
    expect(onDetect).toHaveBeenCalledWith('https://youtube.com/watch?v=x')
  })

  it('disables the button when disabled prop is true', () => {
    render(<UrlInput onDetect={jest.fn()} disabled={true} loading={false} />)
    expect(screen.getByRole('button', { name: /^detect$/i })).toBeDisabled()
  })

  it('shows loading state when loading prop is true', () => {
    render(<UrlInput onDetect={jest.fn()} disabled={false} loading={true} />)
    expect(screen.getByRole('button', { name: /detecting/i })).toBeInTheDocument()
    expect(screen.getByPlaceholderText(/youtube/i)).toBeDisabled()
  })

  it('clears the field with the clear button', () => {
    render(<UrlInput onDetect={jest.fn()} disabled={false} loading={false} />)
    const input = screen.getByPlaceholderText(/youtube/i)
    fireEvent.change(input, { target: { value: 'https://youtube.com/watch?v=x' } })
    fireEvent.click(screen.getByRole('button', { name: /clear the url/i }))
    expect(input).toHaveValue('')
  })

  it('hides the clear button while the field is empty', () => {
    render(<UrlInput onDetect={jest.fn()} disabled={false} loading={false} />)
    expect(screen.queryByRole('button', { name: /clear the url/i })).not.toBeInTheDocument()
  })

  it('detects straight from the clipboard when Paste is clicked', async () => {
    Object.assign(navigator, {
      clipboard: { readText: jest.fn().mockResolvedValue('  https://youtu.be/abc  ') },
    })
    const onDetect = jest.fn()
    render(<UrlInput onDetect={onDetect} disabled={false} loading={false} />)

    fireEvent.click(screen.getByRole('button', { name: /paste/i }))
    await screen.findByDisplayValue('https://youtu.be/abc')
    expect(onDetect).toHaveBeenCalledWith('https://youtu.be/abc')
  })
})
