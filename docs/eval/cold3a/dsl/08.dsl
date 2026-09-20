plan "Townhouse" walls 0.2/0.1 stack ground,upper

level ground h2.6 ground
  room hall "Hall" hall rect 0,0 1.5x6 circulation
  room living "Living room" living rect 1.5,0 4.5x3 habitable
  room kitchen "Kitchen" kitchen rect 1.5,3 4.5x3 habitable
  door hall.west w0.9 entrance
  door hall>living at 1.5,1.5 w0.9
  door hall>kitchen at 1.5,4.5 w0.9
  window living.south w1.6
  window kitchen.south w1.4

level upper h2.5
  room landing "Landing" hall rect 0,0 1.5x6 circulation
  room bed1 "Bedroom 1" bedroom rect 1.5,0 4.5x2 habitable
  room bath "Bathroom" bath rect 1.5,2 4.5x1.5 wet
  room bed2 "Bedroom 2" bedroom rect 1.5,3.5 4.5x2.5 habitable
  door landing>bed1 at 1.5,1 w0.8
  door landing>bath at 1.5,2.75 w0.7
  door landing>bed2 at 1.5,4.75 w0.8
  window bed1.east w1.2
  window bed2.east w1.2
  window bath.east w0.6

stairs stair1 "Main stair" risers:14
  at ground in:hall rect 0.2,0.2 1.1x2.6
  at upper in:landing rect 0.2,0.2 1.1x2.6
