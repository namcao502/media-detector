import { render, screen, fireEvent } from '@testing-library/react'
import OutputDirRow from '../OutputDirRow'

const DIR = 'C:\\Music'

describe('OutputDirRow', () => {
  it('renders the current folder path', () => {
    render(<OutputDirRow dir={DIR} onChange={jest.fn()} onReset={jest.fn()} />)
    expect(screen.getByDisplayValue(DIR)).toBeInTheDocument()
  })

  it('calls onChange when the path is edited', () => {
    const onChange = jest.fn()
    render(<OutputDirRow dir={DIR} onChange={onChange} onReset={jest.fn()} />)
    fireEvent.change(screen.getByDisplayValue(DIR), { target: { value: 'D:\\x' } })
    expect(onChange).toHaveBeenCalledWith('D:\\x')
  })

  it('calls onReset when Reset is clicked', () => {
    const onReset = jest.fn()
    render(<OutputDirRow dir={DIR} onChange={jest.fn()} onReset={onReset} />)
    fireEvent.click(screen.getByRole('button', { name: /reset/i }))
    expect(onReset).toHaveBeenCalled()
  })
})
