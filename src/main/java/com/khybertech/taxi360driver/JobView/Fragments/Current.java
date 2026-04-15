package com.khybertech.taxi360driver.JobView.Fragments;


import android.app.ProgressDialog;
import android.content.Context;
import android.content.DialogInterface;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.os.AsyncTask;
import android.os.Bundle;
import android.preference.PreferenceManager;
import android.support.annotation.Nullable;
import android.support.design.widget.FloatingActionButton;
import android.support.v4.app.Fragment;
import android.support.v7.app.AlertDialog;
import android.util.Log;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.AdapterView;
import android.widget.Button;
import android.widget.ListView;
import android.widget.SimpleAdapter;
import android.widget.TextView;
import android.widget.Toast;

import com.android.volley.DefaultRetryPolicy;
import com.android.volley.Request;
import com.android.volley.Response;
import com.android.volley.VolleyError;
import com.android.volley.toolbox.StringRequest;
import com.khybertech.taxi360driver.JobView.AddJob.AddJob;
import com.khybertech.taxi360driver.JobView.CurrentJobDetail;
import com.khybertech.taxi360driver.JobView.UpdateJob.SecurePreferences;
import com.khybertech.taxi360driver.JobView.UpdateJob.UpdateJob;
import com.khybertech.taxi360driver.MainActivity.TaximetterActivity;
import com.khybertech.taxi360driver.Maps.MapsActivityJobLocation;
import com.khybertech.taxi360driver.R;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.OutputStreamWriter;
import java.io.UnsupportedEncodingException;
import java.net.HttpURLConnection;
import java.net.MalformedURLException;
import java.net.ProtocolException;
import java.net.SocketTimeoutException;
import java.net.URL;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * A simple {@link Fragment} subclass.
 */
public class Current extends Fragment {

    String url_current = "";//"http://webservices.360taxitaxi.co.nz/api/DriverApp/FnDriverCurrentJobs";
    Context con;
    SecurePreferences pref;
    SimpleAdapter adapter_list_current;
    ListView lv_fragment_current;
    List<HashMap<String,Object>> ls;
    String status;
    int driverId;
    public Button btn_available_fragmentCurrent,btn_busy_fragmentCurrent,btn_away_fragmentCurrent;
    FloatingActionButton btn_addjob;
    StringRequest postRequest;
    StringRequest postrequest;

    public Current() {
        // Required empty public constructor
    }

    @Override
    public View onCreateView(LayoutInflater inflater, ViewGroup container,
                             Bundle savedInstanceState) {
        View v = inflater.inflate(R.layout.fragment_current, container, false);
        lv_fragment_current = (ListView) v.findViewById(R.id.lv_fragment_current);
        btn_available_fragmentCurrent = (Button) v.findViewById(R.id.btn_available_fragmentCurrent);
        btn_busy_fragmentCurrent = (Button) v.findViewById(R.id.btn_busy_fragmentCurrent);
        btn_away_fragmentCurrent = (Button) v.findViewById(R.id.btn_away_fragmentCurrent);
        btn_addjob = (FloatingActionButton) v.findViewById(R.id.btn_addjob);

//        pref = PreferenceManager.getDefaultSharedPreferences(v.getContext());
          pref = appcontext.getInstance().pref;
        url_current = appcontext.getInstance().link;

       // c = getActivity().getApplicationContext();
        ls = new ArrayList<>();
        btn_available_fragmentCurrent.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View view) {
                AlertDialog.Builder alert = new AlertDialog.Builder(getContext());
                alert.setTitle("CabsWiki");
                alert.setMessage("Do you want to update status?");
                alert.setPositiveButton("Yes", new DialogInterface.OnClickListener() {
                    @Override
                    public void onClick(DialogInterface dialogInterface, int i) {
                        driverId = Integer.parseInt(appcontext.getInstance().DriverId);
                        status = "Available";
                        ChangestatusRequest();
                      //  new changeStatus().execute();
                    }
                });
                alert.show();
            }
        });
        btn_away_fragmentCurrent.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View view) {

                AlertDialog.Builder alert = new AlertDialog.Builder(getActivity());
                alert.setTitle("CabsWiki");
                alert.setMessage("Do you want to update status?");
                alert.setPositiveButton("Yes", new DialogInterface.OnClickListener() {
                    @Override
                    public void onClick(DialogInterface dialogInterface, int i) {
                        driverId = Integer.parseInt(appcontext.getInstance().DriverId);
                        status = "Away";
                        ChangestatusRequest();
                      //  new changeStatus().execute();
                    }
                });
                alert.show();

            }
        });
        btn_busy_fragmentCurrent.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View view) {
                AlertDialog.Builder alert = new AlertDialog.Builder(getActivity());
                alert.setTitle("CabsWiki");
                alert.setMessage("Do you want to update status?");
                alert.setPositiveButton("Yes", new DialogInterface.OnClickListener() {
                    @Override
                    public void onClick(DialogInterface dialogInterface, int i) {
                        driverId = Integer.parseInt(appcontext.getInstance().DriverId);
                        status = "Busy";
                        appcontext.getInstance().busyclicked = 1;
                        btn_busy_fragmentCurrent.setBackgroundColor(Color.parseColor(appcontext.getInstance().backgroundbusycolor));
                        btn_away_fragmentCurrent.setBackgroundColor(Color.parseColor(appcontext.getInstance().backgroundstatuscolor));
                        btn_available_fragmentCurrent.setBackgroundColor(Color.parseColor(appcontext.getInstance().backgroundstatuscolor));
                        startActivity(new Intent(getContext(), MapsActivityJobLocation.class));
                        getActivity().finish();
//                        ChangestatusRequest();

                      //  new changeStatus().execute();
                    }
                });
                alert.show();
            }
        });
        btn_addjob.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View view) {
                startActivity(new Intent(getActivity(), AddJob.class));
            }
        });

        btn_addjob.setOnLongClickListener(new View.OnLongClickListener() {
            @Override
            public boolean onLongClick(View view) {
                android.app.AlertDialog alertDialog = new android.app.AlertDialog.Builder (getContext()).create();
                alertDialog.setTitle("Emergency Message");
                alertDialog.setMessage("An Emergancy message has been sent to the dispatcher");
                alertDialog.setButton(android.app.AlertDialog.BUTTON_NEUTRAL, "OK",
                        new DialogInterface.OnClickListener() {
                            public void onClick(DialogInterface dialog, int which) {

                                dialog.dismiss();
                            }
                        });
                alertDialog.show();

                return true;
            }
        });
    if (appcontext.getInstance().backgroundstatus .equalsIgnoreCase("busy")){
        btn_busy_fragmentCurrent.setBackgroundColor(Color.parseColor(appcontext.getInstance().backgroundbusycolor));
        btn_away_fragmentCurrent.setBackgroundColor(Color.parseColor(appcontext.getInstance().backgroundstatuscolor));
        btn_available_fragmentCurrent.setBackgroundColor(Color.parseColor(appcontext.getInstance().backgroundstatuscolor));

    } else if (appcontext.getInstance().backgroundstatus .equalsIgnoreCase("away")){
        btn_away_fragmentCurrent.setBackgroundColor(Color.parseColor(appcontext.getInstance().backgroundawaycolor));
        btn_busy_fragmentCurrent.setBackgroundColor(Color.parseColor(appcontext.getInstance().backgroundstatuscolor));
        btn_available_fragmentCurrent.setBackgroundColor(Color.parseColor(appcontext.getInstance().backgroundstatuscolor));
    }else if (appcontext.getInstance().backgroundstatus .equalsIgnoreCase("available")){
        btn_available_fragmentCurrent.setBackgroundColor(Color.parseColor(appcontext.getInstance().backgroundavailablecolor));
        btn_away_fragmentCurrent.setBackgroundColor(Color.parseColor(appcontext.getInstance().backgroundstatuscolor));
        btn_busy_fragmentCurrent.setBackgroundColor(Color.parseColor(appcontext.getInstance().backgroundstatuscolor));

    }

        return v;
    }

    @Override
    public void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

    }

    @Override
    public void setUserVisibleHint(boolean isVisibleToUser) {
        super.setUserVisibleHint(isVisibleToUser);
        //con = getActivity().getApplicationContext();

            if(isVisibleToUser) {
                con = appcontext.getInstance().con;
                //getActivity().getApplicationContext();
//              try {
//                  Log.d("currentvisibility", "My Fragment is visible current");
//                  if (pref.getInt("currentstatus", 0) == 1) {
//                      setdata(pref.getString("currentdata", null));
//                      //   break;
//                  } else {
//                      new Handler().postDelayed(new Runnable() {
//                          @Override
//                          public void run() {
//                              setdata(pref.getString("currentdata", null));
//                          }
//                      }, 2000);
//                  }
//              }catch (Exception e){
//                  e.printStackTrace();
//              }
            }

    }


    void MakePostRequest() {

        postRequest = new StringRequest(Request.Method.POST, url_current,
                new Response.Listener<String>() {
                    @Override
                    public void onResponse(String response) {
                        Log.d("data332",response.toString());
                        // pd.dismiss();
                       setdata(response);

                    }
                },
                new Response.ErrorListener() {
                    @Override
                    public void onErrorResponse(VolleyError error) {
                        error.printStackTrace();
                        //   pd.dismiss();
                      //  Toast.makeText(getContext(), "network error", Toast.LENGTH_SHORT).show();
                    }
                }
        ) {
            // here is params will add to your url using post method
            @Override
            protected Map<String, String> getParams() {
                Map<String, String> params = new HashMap<>();
                params.put("DriverId", appcontext.getInstance().DriverId+"" );

                // "DriverId="+pref.getInt("user_id",0);
                //params.put("2ndParamName","valueoF2ndParam");
                return params;
            }
        };
        postRequest.setRetryPolicy(new DefaultRetryPolicy(5000,
                DefaultRetryPolicy.DEFAULT_MAX_RETRIES,
                DefaultRetryPolicy.DEFAULT_BACKOFF_MULT));
        appcontext.getInstance().mRequestQueue.add(postRequest);
//        Volley.newRequestQueue(con).add(postRequest);
    }


   public void setdata(String s) {
      //  super.onPostExecute(s);
        //   pd.dismiss();

        if (1==0){
        //    retry();
        }
        else {
            try {
                Log.e("currentfragsetdata",s);
                ls.clear();
//                JSONObject obj = new JSONObject(s);
                JSONArray arr = new JSONArray(s);
                for (int i = 0; i < arr.length(); i++) {
                    int booking_id = arr.getJSONObject(i).getInt("BookingId");
                    String passenger_name = arr.getJSONObject(i).getString("Name");
                    String passenger_contact = arr.getJSONObject(i).getString("PassengerId");
                    HashMap<String, Object> hm = new HashMap<>();
                    hm.put("booking_id", booking_id);
                    hm.put("passenger_name", passenger_name);
                    hm.put("passenger_contact", passenger_contact);
                    ls.add(hm);
                }
                String[] from = {"booking_id", "passenger_name", "passenger_contact"};
                int[] to = {R.id.txt_list_current_bookingid, R.id.txt_list_current_passengername, R.id.txt_list_current_passengercontact};
                adapter_list_current = new SimpleAdapter(getActivity(), ls, R.layout.row_list_fragments, from, to);
                adapter_list_current.notifyDataSetChanged();
                lv_fragment_current.setAdapter(adapter_list_current);
                lv_fragment_current.setOnItemClickListener(new AdapterView.OnItemClickListener() {
                    @Override
                    public void onItemClick(AdapterView<?> adapterView, View view, int i, long l) {
                        String booking_id = ((TextView) view.findViewById(R.id.txt_list_current_bookingid)).getText().toString();
                        startActivity(new Intent(getActivity(), CurrentJobDetail.class).putExtra("booking_id", booking_id));
                    }
                });
                lv_fragment_current.setOnItemLongClickListener(new AdapterView.OnItemLongClickListener() {
                    @Override
                    public boolean onItemLongClick(AdapterView<?> adapterView, View view, int i, long l) {
                        TextView txt_list_current_bookingid = (TextView) view.findViewById(R.id.txt_list_current_bookingid);
                        TextView txt_list_current_passengercontact = (TextView) view.findViewById(R.id.txt_list_current_passengercontact);
                        Intent startBooking = new Intent(getActivity(), UpdateJob.class);
                        startBooking.putExtra("booking_id", txt_list_current_bookingid.getText().toString());
                        startBooking.putExtra("passenger_id", txt_list_current_passengercontact.getText().toString());
                        startActivity(startBooking);
                        return true;
                    }
                });
            } catch (Exception ex) {

            }
        }
    }

    @Override
    public void onResume() {
        super.onResume();
        Log.e("fragmentDataccurrent","OnResume");
    }

    @Override
    public void onPause() {
        super.onPause();

      // postRequest.cancel();
       // postrequest.cancel();
        Log.e("fragmentDatacurrent","OnPause");
    }

    @Override
    public void onStop() {
        super.onStop();

        Log.e("fragmentDatacurrent","OnStop");
    }

    @Override
    public void onStart() {
        super.onStart();
      //  MakePostRequest();

       // new getCurrentJobs().execute();
        Log.e("fragmentDataurrent","OnStart");
//        while(true) {
//            new Handler().postDelayed(new Runnable() {
//                @Override
//                public void run() {
//                    setdata(pref.getString("currentdata", null));
//                }
//            }, 4000);
//        }
    }

    public class getCurrentJobs extends AsyncTask<Void,Void,String>{
        ProgressDialog pd;
        String data = "";
        @Override
        protected void onPreExecute() {
           // pd = ProgressDialog.show(getActivity(),"360taxi Taxi","Downloading",false,false);
        }

        @Override
        protected String doInBackground(Void... voids) {
            try{
                URL url = new URL(url_current);
                HttpURLConnection conn = (HttpURLConnection)url.openConnection();
                conn.setDoOutput(true);
                conn.setRequestMethod("POST");
                conn.setConnectTimeout(10000);
                String params = "DriverId="+appcontext.getInstance().DriverId;
                OutputStreamWriter writer = new OutputStreamWriter(conn.getOutputStream());
                writer.write(params);
                writer.flush();
                BufferedReader reader = new BufferedReader(new InputStreamReader(conn.getInputStream(),"UTF-8"));
                data = reader.readLine();
                writer.close();
                reader.close();
            }
            catch (Exception ex){
                Log.e("amad",ex.getMessage().toString());
                data = "error";
            }
            return data;
        }

        @Override
        protected void onPostExecute(String s) {
            super.onPostExecute(s);
         //   pd.dismiss();
            if (s.equalsIgnoreCase("error")){
                retry();
            }
            else {
                try {
                    ls.clear();
                    JSONObject obj = new JSONObject(s);
                    JSONArray arr = obj.getJSONArray("DriverJobsInfo");
                    for (int i = 0; i < arr.length(); i++) {
                        int booking_id = arr.getJSONObject(i).getInt("BookingId");
                        String passenger_name = arr.getJSONObject(i).getString("Name");
                        String passenger_contact = arr.getJSONObject(i).getString("PassengerId");
                        HashMap<String, Object> hm = new HashMap<>();
                        hm.put("booking_id", booking_id);
                        hm.put("passenger_name", passenger_name);
                        hm.put("passenger_contact", passenger_contact);
                        ls.add(hm);
                    }
                    String[] from = {"booking_id", "passenger_name", "passenger_contact"};
                    int[] to = {R.id.txt_list_current_bookingid, R.id.txt_list_current_passengername, R.id.txt_list_current_passengercontact};
                    adapter_list_current = new SimpleAdapter(getActivity(), ls, R.layout.row_list_fragments, from, to);
                    adapter_list_current.notifyDataSetChanged();
                    lv_fragment_current.setAdapter(adapter_list_current);
                    lv_fragment_current.setOnItemClickListener(new AdapterView.OnItemClickListener() {
                        @Override
                        public void onItemClick(AdapterView<?> adapterView, View view, int i, long l) {
                            String booking_id = ((TextView) view.findViewById(R.id.txt_list_current_bookingid)).getText().toString();
                            startActivity(new Intent(getActivity(), CurrentJobDetail.class).putExtra("booking_id", booking_id));
                        }
                    });
                    lv_fragment_current.setOnItemLongClickListener(new AdapterView.OnItemLongClickListener() {
                        @Override
                        public boolean onItemLongClick(AdapterView<?> adapterView, View view, int i, long l) {
                            TextView txt_list_current_bookingid = (TextView) view.findViewById(R.id.txt_list_current_bookingid);
                            TextView txt_list_current_passengercontact = (TextView) view.findViewById(R.id.txt_list_current_passengercontact);
                            Intent startBooking = new Intent(getActivity(), UpdateJob.class);
                            startBooking.putExtra("booking_id", txt_list_current_bookingid.getText().toString());
                            startBooking.putExtra("passenger_id", txt_list_current_passengercontact.getText().toString());
                            startActivity(startBooking);
                            return true;
                        }
                    });
                } catch (Exception ex) {

                }
            }
        }
    }





    void ChangestatusRequest() {

        postRequest = new StringRequest(Request.Method.POST, appcontext.getInstance().link,
                new Response.Listener<String>() {
                    @Override
                    public void onResponse(String response) {
                        Log.d("data332",response.toString());
                        // pd.dismiss();
                        setdatastatus(response);


                    }
                },
                new Response.ErrorListener() {
                    @Override
                    public void onErrorResponse(VolleyError error) {
                        error.printStackTrace();
                        //   pd.dismiss();
                        Toast.makeText(getContext(), "network error", Toast.LENGTH_SHORT).show();
                    }
                }
        ) {
            // here is params will add to your url using post method
            @Override
            protected Map<String, String> getParams() {
                Map<String, String> params = new HashMap<>();
//                params.put("DriverId", driverId+"");
//                params.put("Status", "FnDriverStatusUpdate");


                params.put("Parms", "ZoneId,,"+appcontext.getInstance().currentzone
                        +"&&VehicleId,,"+pref.getString("SelectedVehicleid")
                        +"&&CompanyId,,"+pref.getString("company_id")
                        +"&&DriverId,,"+appcontext.getInstance().DriverId
                        +"&&Status,,"+status);
                params.put("Action", "FnDriverStatusUpdate");
                params.put("UserKey", appcontext.getInstance().passforlink);
                params.put("Token", appcontext.getInstance().token);
                // "DriverId="+pref.getInt("user_id",0);
                //params.put("2ndParamName","valueoF2ndParam");
                return params;
            }
        };
        postRequest.setRetryPolicy(new DefaultRetryPolicy(5000,
                DefaultRetryPolicy.DEFAULT_MAX_RETRIES,
                DefaultRetryPolicy.DEFAULT_BACKOFF_MULT));
        appcontext.getInstance().mRequestQueue.add(postRequest);
//        Volley.newRequestQueue(getContext()).add(postrequest);
    }

    public void setdatastatus(String s) {
        // pd.dismiss();
         try {
             Toast.makeText(getActivity(), new JSONArray(s).getJSONObject(0).getString("Result"), Toast.LENGTH_SHORT).show();

            if(status.equalsIgnoreCase("busy")) {
                appcontext.getInstance().busyclicked = 1;
                startActivity(new Intent(getContext(), TaximetterActivity.class));
                btn_busy_fragmentCurrent.setBackgroundColor(Color.parseColor(appcontext.getInstance().backgroundbusycolor));
                btn_away_fragmentCurrent.setBackgroundColor(Color.parseColor(appcontext.getInstance().backgroundstatuscolor));
                btn_available_fragmentCurrent.setBackgroundColor(Color.parseColor(appcontext.getInstance().backgroundstatuscolor));

            } else if(status.equalsIgnoreCase("away")){
                appcontext.getInstance().backgroundstatus = "Away";
                btn_away_fragmentCurrent.setBackgroundColor(Color.parseColor(appcontext.getInstance().backgroundawaycolor));
                btn_busy_fragmentCurrent.setBackgroundColor(Color.parseColor(appcontext.getInstance().backgroundstatuscolor));
                btn_available_fragmentCurrent.setBackgroundColor(Color.parseColor(appcontext.getInstance().backgroundstatuscolor));
            }else if(status.equalsIgnoreCase("available")){
                appcontext.getInstance().backgroundstatus = "Available";
                btn_available_fragmentCurrent.setBackgroundColor(Color.parseColor(appcontext.getInstance().backgroundavailablecolor));
                btn_away_fragmentCurrent.setBackgroundColor(Color.parseColor(appcontext.getInstance().backgroundstatuscolor));
                btn_busy_fragmentCurrent.setBackgroundColor(Color.parseColor(appcontext.getInstance().backgroundstatuscolor));

            }
        }catch (Exception e){
            e.printStackTrace();
        }
    }




    public class changeStatus extends AsyncTask<String,Void,String>{
        String data="";
        ProgressDialog pd;

        @Override
        protected void onPreExecute() {
         //   pd = ProgressDialog.show(getActivity(),"Cabs Wiki","Updating Status",false,false);
        }

        @Override
        protected String doInBackground(String... strings) {
            try {
                URL url = new URL(appcontext.getInstance().link);
                String params = "DriverId="+driverId+"&Status="+status;
                Log.e("params",params);
                HttpURLConnection conn = (HttpURLConnection) url.openConnection();
                conn.setConnectTimeout(3000);
                conn.setReadTimeout(3000);
                conn.setRequestMethod("POST");
                conn.setDoOutput(true);
                OutputStreamWriter writer = new OutputStreamWriter(conn.getOutputStream());
                writer.write(params);
                writer.flush();
                BufferedReader reader = new BufferedReader(new InputStreamReader(conn.getInputStream(),"UTF-8"));
                data = reader.readLine();
                writer.close();
                reader.close();
            } catch (UnsupportedEncodingException e) {
                e.printStackTrace();
            } catch (ProtocolException e) {
                e.printStackTrace();
            } catch (MalformedURLException e) {
                e.printStackTrace();
            } catch (SocketTimeoutException e){
                retry();
            } catch (IOException e) {
                e.printStackTrace();
            }
            return data;
        }

        @Override
        protected void onPostExecute(String s) {
            super.onPostExecute(s);
           // pd.dismiss();
            Toast.makeText(getActivity(), s, Toast.LENGTH_SHORT).show();
        }
    }

    public void retry(){
      //  MakePostRequest();
       // new getCurrentJobs().execute();
    }


}
