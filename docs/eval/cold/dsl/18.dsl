plan "Shop" units:m

level ground "Ground" ground

room shop_floor "Shop Floor" other rect 0,0 6x5
room storeroom "Storeroom" storage rect 6,0 3x3.5
room staff_wc "Staff WC" wc rect 6,3.5 1.5x1.5 wet

door shop_floor.west w1.5 entrance id:street_door
door shop_floor>storeroom w0.9 on:shop_floor.east near:6,1.75
door storeroom>staff_wc w0.8 on:storeroom.south
