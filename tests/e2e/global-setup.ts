import { axeBaseline } from './baseline'
import { qaBaseline } from './design-qa-baseline'

export default function globalSetup() { axeBaseline.clearParts(); qaBaseline.clearParts() }
