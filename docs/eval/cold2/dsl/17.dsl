plan "Loft Conversion" stack ground,loft

level ground "Ground Floor" ground
room hall "Hall" hall rect 0,0 2x2 circulation

level loft "Loft" h2.4
room main "Loft Room" living rect 0,0 6x5
room shower "Shower Room" wc rect 6,0 2x2.5

stairs main_stair "Stair"
  at ground in:hall rect 0.2,0.2 1x1.6
  at loft in:main rect 0.2,0.2 1x1.6

door main>shower w0.7 hinge:end swing:shower id:showerdoor1
