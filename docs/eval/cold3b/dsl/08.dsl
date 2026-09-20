plan "Townhouse" walls 0.2/0.1

level ground
  room hall "Hall" hall rect 0,0 2x3
  room living "Living room" living rect 2,0 4x3
  room kitchen "Kitchen" kitchen rect 0,3 6x2
  door hall.west w0.9 entrance
  door hall>living @0.5 w0.9
  door hall>kitchen on:kitchen.north @0.5 w0.9
  window living.south w2
  window kitchen.south w1.5

level first h2.6
  room landing "Landing" hall rect 2.5,0 1.5x5
  room bedroom1 "Bedroom 1" bedroom rect 0,0 2.5x2.5
  room bath "Bathroom" bath rect 0,2.5 2.5x2.5
  room bedroom2 "Bedroom 2" bedroom rect 4,0 2x5
  door landing>bedroom1 @0.5 w0.8
  door landing>bath @0.5 w0.7
  door landing>bedroom2 @1 w0.8
  window bedroom1.north w1.2
  window bath.south w0.6
  window bedroom2.east w1.2

stairs main "Main stair" risers:16
  at ground in:hall rect 0.2,0.2 1x1.3
  at first in:landing rect 2.6,0.2 1x1.3
