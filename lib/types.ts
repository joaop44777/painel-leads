export type ElementKind = 'text' | 'image' | 'rect' | 'ellipse' | 'line' | 'arrow' | 'unknown'

export type EditorElement = {
  id: string
  page: number
  kind: ElementKind
  name: string
  x: number
  y: number
  width: number
  height: number
  rotation: number
  text?: string
  originalText?: string
  fontSize?: number
  fontFamily?: string
  fontKey?: string
  originalFontFamily?: string
  originalFontSize?: number
  originalFontWeight?: 'normal' | 'bold'
  originalFontStyle?: 'normal' | 'italic'
  fontWeight?: 'normal' | 'bold'
  fontStyle?: 'normal' | 'italic'
  underline?: boolean
  textAlign?: 'left' | 'center' | 'right'
  lineHeight?: number
  color?: string
  fill?: string
  stroke?: string
  strokeWidth?: number
  opacity?: number
  src?: string
  sourceIndex?: number
  editable?: boolean
  visible?: boolean
  nativeEdit?: 'pending' | 'applied' | 'fallback'
}

export type PageInfo = {
  index: number
  width: number
  height: number
  thumbnail?: string
  textCount: number
}
