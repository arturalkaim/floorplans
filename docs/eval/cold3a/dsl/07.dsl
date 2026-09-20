plan "Cabin with a sleeping loft" walls 0.2/0.1 stack ground,loft

level ground h2.6 ground
  room main "Main room" living rect 0,0 4x4 habitable
  door main.south w0.9 entrance
  window main.north w1.5

level loft h1.9
  room loft_room "Sleeping loft" bedroom rect 0,0 4x2 habitable
  window loft_room.north w1.0

stairs ladder1 "Ladder stair" risers:12
  at ground in:main rect 3.5,3.5 0.4x0.4
  at loft in:loft_room rect 3.5,0 0.4x0.4
