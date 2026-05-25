package com.khybertech.taxi360driver.Maps;

import android.Manifest;
import android.content.pm.PackageManager;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.support.v4.app.ActivityCompat;
import android.support.v4.app.FragmentActivity;
import android.os.Bundle;
import android.widget.TextView;

import com.khybertech.taxi360driver.R;
import com.cs.googlemaproute.DrawRoute;
import com.google.android.gms.maps.CameraUpdateFactory;
import com.google.android.gms.maps.GoogleMap;
import com.google.android.gms.maps.OnMapReadyCallback;
import com.google.android.gms.maps.SupportMapFragment;
import com.google.android.gms.maps.model.BitmapDescriptorFactory;
import com.google.android.gms.maps.model.LatLng;
import com.google.android.gms.maps.model.Marker;
import com.google.android.gms.maps.model.MarkerOptions;

public class TestingMap extends FragmentActivity implements OnMapReadyCallback,DrawRoute.onDrawRoute {

    private GoogleMap mMap;
    Marker m = null;
    TextView txt_location_testing;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_testing_map);
        // Obtain the SupportMapFragment and get notified when the map is ready to be used.
        SupportMapFragment mapFragment = (SupportMapFragment) getSupportFragmentManager()
                .findFragmentById(R.id.map);
        mapFragment.getMapAsync(this);
    }

    @Override
    public void onMapReady(GoogleMap googleMap) {
        mMap = googleMap;

        LocationManager lMngr = (LocationManager) getSystemService(LOCATION_SERVICE);
        if (ActivityCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED && ActivityCompat.checkSelfPermission(this, Manifest.permission.ACCESS_COARSE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(TestingMap.this, new String[]{Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION}, 1);
            return;
        }
        lMngr.requestLocationUpdates(lMngr.GPS_PROVIDER, 0, 0, new LocationListener() {
            @Override
            public void onLocationChanged(Location location) {
                LatLng sydney = new LatLng(location.getLatitude(), location.getLongitude());
                if (m != null){
                    m.remove();
                }
                int speed=(int) ((location.getSpeed()*3600)/1000);
                m = mMap.addMarker(new MarkerOptions().position(sydney).title(""+speed).icon(BitmapDescriptorFactory.fromResource(R.mipmap.marker_moving)));
                //mMap.addPolyline(new PolylineOptions().add(sydney).width(15).color(Color.RED));
                mMap.moveCamera(CameraUpdateFactory.newLatLng(sydney));
            }

            @Override
            public void onStatusChanged(String s, int i, Bundle bundle) {

            }

            @Override
            public void onProviderEnabled(String s) {

            }

            @Override
            public void onProviderDisabled(String s) {

            }
        });

        DrawRoute.getInstance(this,TestingMap.this).setFromLatLong(34.030515, 71.610523).setToLatLong(34.014835, 71.579834).setGmapAndKey("AIzaSyDIlLZDpuufZxEg8EIV25svOsaRj6ng99I",mMap).setColorHash("#ffb600").run();
    }

    @Override
    public void afterDraw(String result) {

    }
}
