plan "Loft conversion" walls 0.2/0.1

level ground
  room hall "Hall" hall rect 0,0 2x2
  door hall.south w0.9 entrance

level loft h2.4
  room loftroom "Loft room" living rect 0,0 6x4
  room shower "Shower room" bath rect 6,0 1.5x4
  door loftroom>shower @0.5 w0.7
  window loftroom.north w2
  window shower.east w0.5

stairs main "Stair" risers:14
  at ground in:hall rect 0.2,0.2 1x1.6
  at loft in:loftroom rect 4.8,0.2 1x1.6
