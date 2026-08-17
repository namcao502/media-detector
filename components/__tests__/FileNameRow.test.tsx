import { render, screen, fireEvent } from '@testing-library/react'
import FileNameRow from '../FileNameRow'

const source = {
  title: 'Daft Punk - Instant Crush (Official Video) ft. Julian Casablancas',
  uploader: 'Daft Punk',
}

function renderRow(overrides: Partial<React.ComponentProps<typeof FileNameRow>> = {}) {
  const props = {
    source,
    clean: true,
    onToggle: jest.fn(),
    customName: null,
    onCustomNameChange: jest.fn(),
    ...overrides,
  }
  return { ...render(<FileNameRow {...props} />), props }
}

describe('FileNameRow', () => {
  it('previews the cleaned name when cleaning is on', () => {
    renderRow()
    expect(screen.getByText('Instant Crush - Daft Punk')).toBeInTheDocument()
  })

  it('previews the untouched title when cleaning is off', () => {
    renderRow({ clean: false })
    expect(screen.getByText(source.title)).toBeInTheDocument()
  })

  it('reveals the original name on request', () => {
    renderRow()
    expect(screen.queryByText(`was: ${source.title}`)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /show original name/i }))
    expect(screen.getByText(`was: ${source.title}`)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /hide original name/i }))
    expect(screen.queryByText(`was: ${source.title}`)).not.toBeInTheDocument()
  })

  it('hides the original-name control when cleaning changes nothing', () => {
    renderRow({ source: { title: 'Instant Crush', artist: 'Corbyn Kites' }, clean: false })
    expect(screen.queryByRole('button', { name: /show original name/i })).not.toBeInTheDocument()
  })

  it('calls onToggle from the Cleaned/Original button', () => {
    const { props } = renderRow()
    const button = screen.getByRole('button', { name: /^cleaned$/i })
    expect(button).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(button)
    expect(props.onToggle).toHaveBeenCalled()
  })

  it('opens an editor seeded with the current name', () => {
    renderRow()
    fireEvent.click(screen.getByRole('button', { name: /edit/i }))
    expect(screen.getByLabelText('File name')).toHaveValue('Instant Crush - Daft Punk')
  })

  it('saves a typed name', () => {
    const { props } = renderRow()
    fireEvent.click(screen.getByRole('button', { name: /edit/i }))
    fireEvent.change(screen.getByLabelText('File name'), { target: { value: 'My Name' } })
    fireEvent.click(screen.getByRole('button', { name: /save/i }))
    expect(props.onCustomNameChange).toHaveBeenCalledWith('My Name')
  })

  it('saves on Enter and abandons on Escape', () => {
    const { props } = renderRow()
    fireEvent.click(screen.getByRole('button', { name: /edit/i }))
    fireEvent.change(screen.getByLabelText('File name'), { target: { value: 'Typed' } })
    fireEvent.keyDown(screen.getByLabelText('File name'), { key: 'Enter' })
    expect(props.onCustomNameChange).toHaveBeenCalledWith('Typed')

    fireEvent.click(screen.getByRole('button', { name: /edit/i }))
    fireEvent.change(screen.getByLabelText('File name'), { target: { value: 'Discarded' } })
    fireEvent.keyDown(screen.getByLabelText('File name'), { key: 'Escape' })
    expect(props.onCustomNameChange).toHaveBeenCalledTimes(1)
  })

  it('treats an empty or unchanged entry as no override', () => {
    const { props } = renderRow()
    fireEvent.click(screen.getByRole('button', { name: /edit/i }))
    fireEvent.change(screen.getByLabelText('File name'), { target: { value: '   ' } })
    fireEvent.click(screen.getByRole('button', { name: /save/i }))
    expect(props.onCustomNameChange).toHaveBeenCalledWith(null)
  })

  it('shows the custom name and can reset it', () => {
    const { props } = renderRow({ customName: 'Hand Written' })
    expect(screen.getByText('Hand Written')).toBeInTheDocument()
    // The rules no longer apply, so the Cleaned/Original switch is moot.
    expect(screen.getByRole('button', { name: /^cleaned$/i })).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: /reset to automatic/i }))
    expect(props.onCustomNameChange).toHaveBeenCalledWith(null)
  })
})
