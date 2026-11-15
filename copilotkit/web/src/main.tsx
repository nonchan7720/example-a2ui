import { createRoot } from 'react-dom/client'
import { App } from './App.tsx'
import '@copilotkit/react-core/v2/styles.css'
import './styles.css'

const root = document.getElementById('root')
if (root) createRoot(root).render(<App />)
