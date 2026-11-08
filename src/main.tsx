import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import Showcase from './showcase'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Showcase />
  </StrictMode>,
)
