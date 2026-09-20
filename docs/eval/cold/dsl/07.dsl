plan "Cabin With A Sleeping Loft" units:m

level ground "Ground" h2.6 ground
room main_room "Main Room" living rect 0,0 5x5 habitable

level loft "Loft" h2.2
room loft_room "Loft" bedroom rect 0,0 5x2.5 habitable

stairs ladder_stair "Ladder Stair" up:38 risers:10
  at ground in:main_room rect 4,4 1x1
