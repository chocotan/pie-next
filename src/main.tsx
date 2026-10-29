import React from 'react'
import ReactDOM from 'react-dom/client'
import { IconSprite } from './modules/theme/IconSprite.tsx'
import { App } from './App.tsx'
import './modules/theme/base.css'
import './modules/theme/styles/corner-shape.css'
import './modules/theme/styles/design-platform.css'
import './modules/theme/styles/focus.css'
import './modules/theme/styles/onboarding.css'
import './modules/theme/styles/scrollbar.css'
import './modules/theme/styles/gradient-shadow-text.css'
import './modules/theme/styles/shiki.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><IconSprite /><App /></React.StrictMode>,
)
