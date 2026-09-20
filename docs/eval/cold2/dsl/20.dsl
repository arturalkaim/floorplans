plan "Semi-Detached House" stack ground,first

level ground "Ground Floor" ground
room hall "Hall" hall rect 0,0 2x4 circulation
room living "Living Room" living rect 2,0 4x4
room kitchen "Kitchen" kitchen rect 6,0 3x4

level first "First Floor" h2.6
room landing "Landing" hall rect 0,0 2x2 circulation
room bed1 "Bedroom 1" bedroom rect 6,0 3x2
room bed2 "Bedroom 2" bedroom rect 6,2 3x2
room bathroom "Bathroom" wc rect 0,2 2x2
void living_void "Void over Living Room" rect 2,0 4x4

stairs main "Main Stair"
  at ground in:hall rect 0.2,0.2 1x2
  at first in:landing rect 0.2,0.2 1x1.6

door hall.west w0.9 entrance
door hall>living w0.9 hinge:start swing:living
door hall>kitchen w0.9 hinge:start swing:kitchen
door landing>bed1 w0.8 hinge:start swing:bed1
door landing>bed2 w0.8 hinge:start swing:bed2
door landing>bathroom w0.7 hinge:end swing:bathroom
