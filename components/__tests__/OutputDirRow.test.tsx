import { render, screen, fireEvent } from '@testing-library/react'
import OutputDirRow from '../OutputDirRow'

const DIR = 'C:\\Music'

function startEditing() {
  fireEvent.click(screen.getByRole('button', { name: /change/i }))
}

describe('OutputDirRow', () => {
  it('shows the current folder as plain text when collapsed', () => {
    render(<OutputDirRow dir={DIR} onChange={jest.fn()} onReset={jest.fn()} />)
    expect(screen.getByText(DIR)).toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /reset/i })).not.toBeInTheDocument()
  })

  it('reveals the editable path field after Change', () => {
    render(<OutputDirRow dir={DIR} onChange={jest.fn()} onReset={jest.fn()} />)
    startEditing()
    expect(screen.getByDisplayValue(DIR)).toBeInTheDocument()
  })

  it('calls onChange when the path is edited', () => {
    const onChange = jest.fn()
    render(<OutputDirRow dir={DIR} onChange={onChange} onReset={jest.fn()} />)
    startEditing()
    fireEvent.change(screen.getByDisplayValue(DIR), { target: { value: 'D:\\x' } })
    expect(onChange).toHaveBeenCalledWith('D:\\x')
  })

  it('calls onReset when Reset is clicked', () => {
    const onReset = jest.fn()
    render(<OutputDirRow dir={DIR} onChange={jest.fn()} onReset={onReset} />)
    startEditing()
    fireEvent.click(screen.getByRole('button', { name: /reset/i }))
    expect(onReset).toHaveBeenCalled()
  })

  it('collapses again after Done', () => {
    render(<OutputDirRow dir={DIR} onChange={jest.fn()} onReset={jest.fn()} />)
    startEditing()
    fireEvent.click(screen.getByRole('button', { name: /done/i }))
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })
})
