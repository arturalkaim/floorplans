plan "Semi-detached with a void" walls 0.2/0.1 stack ground,upper

level ground h4.8 ground
  room living "Living room" living rect 0,0 4x4 habitable
  room kitchen "Kitchen" kitchen rect 4,0 3x4 habitable
  room hall "Hall" hall rect 0,4 7x2.6 circulation
  door hall.west w0.9 entrance
  door hall>living at 2,4 w0.9
  door hall>kitchen at 5.5,4 w0.9
  window living.north w2.4
  window kitchen.north w1.4

level upper h2.5
  void living_void "Void over living room" rect 0,0 4x4
  room bed1 "Bedroom 1" bedroom rect 4,0 1.5x4 habitable
  room bath "Bathroom" bath rect 5.5,0 1.5x4 wet
  room landing "Landing" hall rect 0,4 7x2.6 circulation
  door landing>bed1 at 4.75,4 w0.8
  door landing>bath at 6.25,4 w0.7
  window bed1.east w1.0
  window bath.east w0.5

stairs stair1 "Main stair" risers:14
  at ground in:hall rect 0.2,4.2 1.1x2.2
  at upper in:landing rect 0.2,4.2 1.1x2.2
