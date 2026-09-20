plan "Loft Conversion" units:m

level loft "Loft"

room loft_room "Loft Room" bedroom rect 0,0 6x5 habitable
room shower_room "Shower Room" bath rect 6,0 2x2 wet

door loft_room>shower_room w0.8 on:loft_room.east

stairs loft_stair "Loft Stair" up:38 risers:13
  at loft in:loft_room rect 0,0 1x1
