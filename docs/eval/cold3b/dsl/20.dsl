plan "Semi-detached with a void" walls 0.2/0.1

level ground
  room hall "Hall" hall rect 0,0 2x5
  room living "Living room" living rect 2,0 5x5
  door hall.west w0.9 entrance
  door hall>living @1 w1.2
  window living.south w2.4

level first h2.6
  room landing "Landing" hall rect 0,0 2x2
  room bedroom1 "Bedroom 1" bedroom rect 0,2 2x3
  room bedroom2 "Bedroom 2" bedroom rect 2,3 5x2
  void overliving "Void over living" rect 2,0 5x3
  door landing>bedroom1 @1 w0.8
  door landing>bedroom2 on:bedroom2.west @0.5 w0.8
  window bedroom1.west w1.2
  window bedroom2.south w1.5

stairs main "Main stair" risers:15
  at ground in:hall rect 0.2,0.2 1x2.6
  at first in:landing rect 0.2,0.2 1x1.6
