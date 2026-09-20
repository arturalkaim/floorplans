plan "Cabin with a sleeping loft" walls 0.2/0.1

level ground
  room main "Cabin room" living rect 0,0 5x4
  door main.south w0.9 entrance
  window main.west w1.5

level loft h2.2
  room loft "Sleeping loft" bedroom rect 0,0 5x4
  window loft.west w1

stairs ladder "Ladder stair" risers:14
  at ground in:main rect 4,3.4 0.8x0.6
  at loft in:loft rect 4,3.4 0.8x0.6
