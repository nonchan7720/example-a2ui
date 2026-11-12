import { createRoot } from 'react-dom/client'
import { App } from './App.tsx'
import 'material-icons/iconfont/filled.css'
import './styles.css'

const root = document.getElementById('root')
if (root) createRoot(root).render(<App />)
