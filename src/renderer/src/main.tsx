import { createRoot } from 'react-dom/client'
import { BRAND } from '../../shared/brand'
import App from './App'
import './styles.css'
import './volante.css'

document.documentElement.dataset.brand = BRAND.id
document.title = BRAND.name

createRoot(document.getElementById('root')!).render(<App />)
