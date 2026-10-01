import type { ComponentProps, SVGProps } from 'react'
import * as Io from 'iconoir-react'

type IconProps = SVGProps<SVGSVGElement> & { size?: number }

/** Volante's mark: a V of dots streaming into one accent-coloured point. */
const VX: Record<number, number> = { [-4]: 408, [-3]: 524, [-2]: 641, [-1]: 758, 0: 966, 1: 1174, 2: 1291, 3: 1408, 4: 1524 }
const VY = [487, 607, 727, 846, 966, 1086, 1206, 1326]
const VROWS = [[-4, -3, 0, 3, 4], [-4, -3, 0, 3, 4], [-3, -2, 0, 2, 3], [-3, -2, 0, 2, 3], [-2, -1, 0, 1, 2], [-2, -1, 0, 1, 2], [-1, 0, 1], [-1, 0, 1]]

export function VolanteLogo({ size = 28, ...p }: IconProps) {
  return (
    <svg viewBox="340 420 1252 1100" width={size} height={size} aria-hidden {...p}>
      {VROWS.flatMap((cols, row) => cols.map((c) => <circle key={`${row}:${c}`} cx={VX[c]} cy={VY[row]} r={50} fill="currentColor" />))}
      <circle cx={966} cy={1446} r={50} fill="var(--accent)" />
    </svg>
  )
}

export const BrandLogo = VolanteLogo

type IoIcon = typeof Io.Plus
type IoProps = ComponentProps<IoIcon>

function io(Icon: IoIcon) {
  return function WrappedIcon({ size = 18, ref: _ref, ...p }: IconProps) {
    return <Icon width={size} height={size} strokeWidth={1.7} aria-hidden {...(p as IoProps)} />
  }
}

export const Plus = io(Io.Plus)
export const ServerIcon = io(Io.Server)
export const ActivityIcon = io(Io.Activity)
export const PlugIcon = io(Io.EvPlug)
export const LinkIcon = io(Io.Link)
export const Gear = io(Io.Settings)
export const Refresh = io(Io.Refresh)
export const Trash = io(Io.Trash)
export const Pencil = io(Io.EditPencil)
export const Copy = io(Io.Copy)
export const Check = io(Io.Check)
export const X = io(Io.Xmark)
export const Search = io(Io.Search)
export const ChevronDown = io(Io.NavArrowDown)
export const ChevronRight = io(Io.NavArrowRight)
export const Eye = io(Io.Eye)
export const EyeClosed = io(Io.EyeClosed)
export const ImportIcon = io(Io.Import)
export const CodeIcon = io(Io.Code)
export const TerminalIcon = io(Io.Terminal)
export const Globe = io(Io.Globe)
export const Lock = io(Io.Lock)
export const Key = io(Io.Key)
export const FolderIcon = io(Io.Folder)
export const Warning = io(Io.WarningTriangle)
export const Play = io(Io.Play)
export const Pause = io(Io.Pause)
export const PanelLeft = io(Io.SidebarCollapse)
export const Ellipsis = io(Io.MoreHoriz)
export const External = io(Io.OpenNewWindow)
export const Home = io(Io.HomeSimple)
export const Transfer = io(Io.DataTransferBoth)
export const Paste = io(Io.PasteClipboard)
export const Sparks = io(Io.Sparks)
export const Shield = io(Io.ShieldCheck)
export const LogIn = io(Io.LogIn)
export const LogOut = io(Io.LogOut)
export const Clock = io(Io.Clock)
export const Info = io(Io.InfoCircle)
export const Computer = io(Io.Computer)
export const Undo = io(Io.Undo)
export const Filter = io(Io.Filter)
export const ArrowLeft = io(Io.ArrowLeft)
